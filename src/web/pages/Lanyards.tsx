import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiFailure, api } from '../api';
import { Icon } from '../components/Icon';
import { QrCode } from '../components/QrCode';
import { Loading, Notice, Skeleton } from '../components/ui';
import type { Card, CardSize } from '../lanyards/pdf';
import { CARD_SIZES, SECTION_COLOURS, bandLabel, buildLanyardPdf, downloadPdf } from '../lanyards/pdf';
import { useEvent } from './EventLayout';

/** On-screen preview of one card, drawn to the same layout as the PDF. */
export function LanyardCard({ card, eventName, size = 'lanyard' }: { card: Card; eventName: string; size?: CardSize }) {
  const colours = SECTION_COLOURS[card.kind === 'adult' ? 'Leaders' : card.section] ?? SECTION_COLOURS.Other!;
  const band = { background: colours.bg, color: colours.fg };
  if (size === 'badge') {
    return (
      <article className="card-preview card-badge">
        <div className="card-band" style={band}>
          {bandLabel(card)}
        </div>
        <div className="card-badge-body">
          <div>
            <p className="card-name">{card.name}</p>
            <p className="card-group">{card.groupName}</p>
            <p className="card-code">{card.shortCode}</p>
          </div>
          <QrCode value={card.qr} size="100%" label={`Scan code for ${card.name}`} />
        </div>
      </article>
    );
  }
  return (
    <article className="card-preview card-lanyard">
      <div className="card-band" style={band}>
        {bandLabel(card)}
      </div>
      <div className="card-body">
        <p className="card-name">{card.name}</p>
        <p className="card-group">{card.groupName}</p>
        <div className="card-qr">
          <QrCode value={card.qr} size="100%" label={`Scan code for ${card.name}`} />
        </div>
        <p className="card-code">{card.shortCode}</p>
      </div>
      <p className="card-foot">{eventName}. If found, please hand to a camp leader.</p>
    </article>
  );
}

export function Lanyards() {
  const { event, can } = useEvent();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [missing, setMissing] = useState(0);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [size, setSize] = useState<CardSize>('lanyard');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ tone: 'ok' | 'stop'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [res, roster] = await Promise.all([
        api<{ cards: Card[] }>(`/events/${event.id}/credentials/print`, { body: {} }),
        api<{ registrations: { status: string; shortCode: string | null }[] }>(`/events/${event.id}/registrations`),
      ]);
      setCards(res.cards);
      setMissing(roster.registrations.filter((r) => r.status === 'active' && !r.shortCode).length);
    } catch (err) {
      setMessage({ tone: 'stop', text: err instanceof ApiFailure ? err.message : 'Could not load cards.' });
    }
  }, [event.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => [...new Set((cards ?? []).map((c) => c.groupName))].sort(), [cards]);
  const shown = (cards ?? []).filter(
    (c) => (!group || c.groupName === group) && (!query || `${c.name} ${c.shortCode}`.toLowerCase().includes(query.toLowerCase())),
  );
  const selected = shown.filter((c) => !excluded.has(c.registrationId));

  async function issueMissing() {
    setBusy(true);
    try {
      const { issued } = await api<{ issued: number }>(`/events/${event.id}/credentials/issue`, { body: { mode: 'missing' } });
      setMessage({ tone: 'ok', text: `Created ${issued} new cards.` });
      await load();
    } catch (err) {
      setMessage({ tone: 'stop', text: err instanceof ApiFailure ? err.message : 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  }

  async function makePdf() {
    setBusy(true);
    setMessage(null);
    try {
      const bytes = await buildLanyardPdf(selected, size, event.name);
      const slug = event.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      downloadPdf(bytes, `${slug}-${size === 'lanyard' ? 'lanyards' : 'cards'}.pdf`);
      setMessage({ tone: 'ok', text: `PDF ready: ${selected.length} cards. Print at 100% (actual size), not "fit to page".` });
    } catch {
      setMessage({ tone: 'stop', text: 'The PDF could not be created. Try fewer cards at a time.' });
    } finally {
      setBusy(false);
    }
  }

  if (!can('credentials.manage')) return <Notice tone="stop">You do not have permission to print lanyards.</Notice>;
  if (!cards)
    return message ? (
      <Notice tone={message.tone}>{message.text}</Notice>
    ) : (
      <Loading label="Loading cards">
        <Skeleton width="100%" height="7rem" radius="var(--radius)" />
        <div className="card-grid card-grid-lanyard">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} width="100%" height="auto" radius="4px" className="skeleton-card" />
          ))}
        </div>
      </Loading>
    );

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="lanyards">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {missing > 0 && (
        <Notice tone="warn" title={`${missing} people don't have a card yet`}>
          <button className="btn" disabled={busy} onClick={() => void issueMissing()}>
            Create {missing} cards
          </button>
        </Notice>
      )}

      <div className="lanyard-toolbar">
        <div className="field">
          <label htmlFor="ly-q">Search</label>
          <input id="ly-q" className="input" type="search" placeholder="Name or code" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ly-group">Group</label>
          <select id="ly-group" className="input" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ly-size">Card</label>
          <select id="ly-size" className="input" value={size} onChange={(e) => setSize(e.target.value as CardSize)}>
            {(Object.keys(CARD_SIZES) as CardSize[]).map((k) => (
              <option key={k} value={k}>
                {CARD_SIZES[k].label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="lanyard-actions">
        <p className="flush">
          <strong>{selected.length}</strong> of {shown.length} cards selected.{' '}
          <button className="btn-link" onClick={() => setExcluded(new Set())}>
            Select all
          </button>{' '}
          <button className="btn-link" onClick={() => setExcluded(new Set(shown.map((c) => c.registrationId)))}>
            Clear
          </button>
        </p>
        <button className="btn" disabled={busy || selected.length === 0} onClick={() => void makePdf()}>
          <Icon name="download" /> {busy ? 'Making PDF…' : `Download PDF`}
        </button>
      </div>

      <p className="field-hint narrow">
        Print on A4 at 100% (actual size) and cut along the dashed lines. Keep spare cards secure: a card is enough to be scanned as
        that person.
      </p>

      <ul className={`card-grid card-grid-${size}`}>
        {shown.map((c) => {
          const on = !excluded.has(c.registrationId);
          return (
            <li key={c.registrationId}>
              <label className={on ? 'card-pick is-on' : 'card-pick'}>
                <input type="checkbox" checked={on} onChange={() => toggle(c.registrationId)} />
                <span className="visually-hidden">Include {c.name}</span>
                <LanyardCard card={c} eventName={event.name} size={size} />
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
