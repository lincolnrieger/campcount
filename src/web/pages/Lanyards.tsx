import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiFailure, api } from '../api';
import { Link } from 'react-router';
import { LanyardBack, LanyardCard } from '../components/LanyardCard';
import type { Card, CardSize } from '../lanyards/pdf';
import { CARD_SIZES, buildLanyardPdf, downloadPdf, loadLogoPng } from '../lanyards/pdf';
import { loadArtwork, useLanyardArtwork } from '../lanyards/artwork';
import { Button, Choice, EmptyState, Field, Icon, LoadError, Loading, Notice, PageHeader, SearchField, Segmented, Skeleton, useToast } from '../ui';
import { PHOTO_MARKER_WORDS } from './LanyardSettings';
import { useEvent } from './EventLayout';

/** People › Print lanyards: issue cards and download them as a PDF. */
export function Lanyards() {
  const { event, can } = useEvent();
  const { base: eventBase } = useEvent();
  const toast = useToast();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [missing, setMissing] = useState(0);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [size, setSize] = useState<CardSize>('lanyard');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [doubleSided, setDoubleSided] = useState(true);
  const [side, setSide] = useState<'front' | 'back'>('front');
  const [onlyNoPhotos, setOnlyNoPhotos] = useState(false);
  const art = useLanyardArtwork(event.id);
  const back = { to: `${eventBase}/people`, label: 'People' };

  const load = useCallback(async () => {
    try {
      const [res, roster] = await Promise.all([
        api<{ cards: Card[] }>(`/events/${event.id}/credentials/print`, { body: {} }),
        api<{ registrations: { status: string; shortCode: string | null }[] }>(`/events/${event.id}/registrations`),
      ]);
      setCards(res.cards);
      setMissing(roster.registrations.filter((r) => r.status === 'active' && !r.shortCode).length);
      setFailure(null);
    } catch (err) {
      setFailure(err instanceof ApiFailure ? err : new ApiFailure(0, 'offline', 'No connection.'));
    }
  }, [event.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => [...new Set((cards ?? []).map((c) => c.groupName))].filter(Boolean).sort(), [cards]);
  const shown = (cards ?? []).filter(
    (c) => (!group || c.groupName === group) && (!onlyNoPhotos || c.noPhotos) && (!query || `${c.name} ${c.shortCode}`.toLowerCase().includes(query.toLowerCase())),
  );
  const noPhotoCount = (cards ?? []).filter((c) => c.noPhotos).length;
  const selected = shown.filter((c) => !excluded.has(c.registrationId));

  async function issueMissing() {
    try {
      const { issued } = await api<{ issued: number }>(`/events/${event.id}/credentials/issue`, { body: { mode: 'missing' } });
      toast(`Issued ${issued} new lanyard${issued === 1 ? '' : 's'}`);
      await load();
    } catch (err) {
      toast(err instanceof ApiFailure ? err.message : 'No connection. Try again.', { tone: 'error' });
    }
  }

  async function makePdf() {
    try {
      const [front, backArt, logoPng] = await Promise.all([
        loadArtwork(art.url(size, 'front')),
        doubleSided ? loadArtwork(art.url(size, 'back')) : null,
        doubleSided ? loadLogoPng(event.logoUrl) : null,
      ]);
      const bytes = await buildLanyardPdf(selected, size, event.name, {
        marker: event.lanyard,
        doubleSided,
        logoPng,
        artwork: { front, back: backArt },
        printBand: event.lanyard.printBand,
      });
      const slug = event.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      downloadPdf(bytes, `${slug}-${size === 'lanyard' ? 'lanyards' : 'cards'}.pdf`);
      toast(`PDF ready with ${selected.length} lanyards. Print at 100% (actual size)${doubleSided ? ', both sides, flip on the long edge' : ''}.`);
    } catch {
      toast("The PDF couldn't be made. Try fewer lanyards at a time.", { tone: 'error' });
    }
  }

  const header = (
    <PageHeader
      title="Print lanyards"
      back={back}
      summary="Each lanyard has a QR code and a typed backup code."
      primary={
        cards &&
        cards.length > 0 && (
          <Button kind="primary" disabled={selected.length === 0} busyLabel="Making PDF…" onAction={makePdf}>
            <Icon name="download" />
            Download PDF ({selected.length})
          </Button>
        )
      }
    />
  );

  if (!can('credentials.manage'))
    return (
      <>
        {header}
        <Notice tone="error">
          <p>You don't have permission to print lanyards.</p>
        </Notice>
      </>
    );
  if (failure && !cards)
    return (
      <>
        {header}
        <LoadError error={failure} onRetry={load} what="lanyards" />
      </>
    );
  if (!cards)
    return (
      <>
        {header}
        <Loading what="lanyards">
          <div className="card-grid card-grid-lanyard" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="skeleton-card" />
            ))}
          </div>
        </Loading>
      </>
    );

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      {header}
      <div className="sections">
        {missing > 0 && (
          <Notice tone="warning" title={`${missing} ${missing === 1 ? 'person doesn’t' : 'people don’t'} have a lanyard yet`}>
            <Button busyLabel="Issuing…" onAction={issueMissing}>
              Issue {missing} lanyard{missing === 1 ? '' : 's'}
            </Button>
          </Notice>
        )}
        {cards.length === 0 ? (
          <EmptyState title="No lanyards to print yet">Add people to the event, then issue their lanyards here.</EmptyState>
        ) : (
          <>
            <div className="lanyard-options">
              <SearchField id="ly-q" label="Search name or code" value={query} onChange={setQuery} />
              <Field id="ly-group" label="Scout group">
                <select className="select" value={group} onChange={(e) => setGroup(e.target.value)}>
                  <option value="">All groups</option>
                  {groups.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </Field>
              <fieldset className="field">
                <legend className="field-label">Print</legend>
                <div className="choices">
                  <Choice
                    label="Both sides"
                    description="Each page of fronts is followed by a page of backs. Print double-sided and flip on the long edge."
                    checked={doubleSided}
                    onChange={(e) => {
                      setDoubleSided(e.target.checked);
                      if (!e.target.checked) setSide('front');
                    }}
                  />
                  {noPhotoCount > 0 && (
                    <Choice label={`Only people without photo consent (${noPhotoCount})`} checked={onlyNoPhotos} onChange={(e) => setOnlyNoPhotos(e.target.checked)} />
                  )}
                </div>
              </fieldset>
              <fieldset className="field">
                <legend className="field-label">Size</legend>
                <div className="choices">
                  {(Object.keys(CARD_SIZES) as CardSize[]).map((k) => (
                    <label key={k} className="choice">
                      <input type="radio" name="ly-size" value={k} checked={size === k} onChange={() => setSize(k)} />
                      <span className="choice-text">{CARD_SIZES[k].label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>

            <div className="toolbar">
              <p aria-live="polite">
                <strong>{selected.length}</strong> of {shown.length} selected
              </p>
              <Button small kind="ghost" onClick={() => setExcluded(new Set())}>
                Select all
              </Button>
              <Button small kind="ghost" onClick={() => setExcluded(new Set(shown.map((c) => c.registrationId)))}>
                Select none
              </Button>
            </div>
            <p className="meta">Print on A4 at 100% (actual size) and cut along the dashed lines. Keep spare lanyards secure: a lanyard is enough to be scanned as that person.</p>
            <p className="meta">
              {art.url(size, 'front') || art.url(size, 'back') ? 'Printing on your own artwork.' : 'Printing the built-in design.'}
              {event.features.photo && (
                <>
                  {' '}
                  No photo consent: {PHOTO_MARKER_WORDS[event.lanyard.photoMarker].toLowerCase()}
                  {event.lanyard.photoMarkerLabel ? ', with "No photos" on the band' : ''}.
                </>
              )}{' '}
              {can('event.configure') && <Link to={`${eventBase}/settings/lanyards`}>Change the design</Link>}
            </p>
            {doubleSided && (
              <Segmented
                label="Preview"
                value={side}
                onChange={setSide}
                options={[
                  { value: 'front', label: 'Front' },
                  { value: 'back', label: 'Back' },
                ]}
              />
            )}

            <ul className={`card-grid card-grid-${size}`}>
              {shown.map((c) => {
                const on = !excluded.has(c.registrationId);
                return (
                  <li key={c.registrationId}>
                    <label className={on ? 'card-pick is-on' : 'card-pick'}>
                      <input type="checkbox" checked={on} onChange={() => toggle(c.registrationId)} />
                      <span className="visually-hidden">Include {c.name}</span>
                      {side === 'back' ? (
                        <LanyardBack card={c} size={size} marker={event.lanyard} eventName={event.name} logoUrl={event.logoUrl} artwork={art.url(size, 'back')} />
                      ) : (
                        <LanyardCard card={c} size={size} marker={event.lanyard} artwork={art.url(size, 'front')} printBand={event.lanyard.printBand} />
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
