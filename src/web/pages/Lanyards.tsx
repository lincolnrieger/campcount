import { useState } from 'react';
import { ApiFailure, api } from '../api';
import { QrCode } from '../components/QrCode';
import { Notice } from '../components/ui';
import { useEvent } from './EventLayout';

interface Card {
  registrationId: string;
  name: string;
  kind: 'youth' | 'adult';
  section: string;
  groupName: string;
  shortCode: string;
  qr: string;
}

const SECTION_CLASS: Record<string, string> = {
  Joeys: 'band-joeys',
  Cubs: 'band-cubs',
  Scouts: 'band-scouts',
  Venturers: 'band-venturers',
  Rovers: 'band-rovers',
  Leaders: 'band-leaders',
};

export function LanyardCard({ card, eventName }: { card: Card; eventName: string }) {
  return (
    <article className="lanyard">
      <div className={`lanyard-band ${SECTION_CLASS[card.section] ?? 'band-other'}`}>{card.kind === 'adult' ? 'Leader' : card.section}</div>
      <div className="lanyard-body">
        <p className="lanyard-name">{card.name}</p>
        <p className="lanyard-group">{card.groupName}</p>
        <QrCode value={card.qr} size="58mm" label={`Scan code for ${card.name}`} />
        <p className="lanyard-code">{card.shortCode}</p>
      </div>
      <p className="lanyard-foot">
        {eventName}. If found, please hand to a camp leader.
      </p>
    </article>
  );
}

export function Lanyards() {
  const { event, can } = useEvent();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'stop'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function prepare() {
    setBusy(true);
    setMessage(null);
    try {
      const { issued } = await api<{ issued: number }>(`/events/${event.id}/credentials/issue`, { body: { mode: 'missing' } });
      const res = await api<{ cards: Card[] }>(`/events/${event.id}/credentials/print`, { body: {} });
      setCards(res.cards);
      setMessage({ tone: 'ok', text: `${res.cards.length} cards ready${issued ? `, including ${issued} new` : ''}.` });
    } catch (err) {
      setMessage({ tone: 'stop', text: err instanceof ApiFailure ? err.message : 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  }

  if (!can('credentials.manage')) return <Notice tone="stop">You do not have permission to print lanyards.</Notice>;

  return (
    <>
      <div className="no-print narrow">
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        <h2>Lanyards</h2>
        <p>
          Each card has a QR code and a typed backup code. Neither contains personal details. Print on A4 at 100% scale (not "fit to
          page"), four cards per sheet, and cut along the dashed lines. Cards are 90 × 120 mm to suit standard lanyard pouches.
        </p>
        <p className="field-hint">
          Anyone holding a card can be scanned as that person, so keep spare and old cards secure. If a card is lost, replace it from the
          roster and the old one stops working.
        </p>
        <div className="actions">
          {!cards ? (
            <button className="btn" disabled={busy} onClick={() => void prepare()}>
              {busy ? 'Preparing…' : 'Prepare cards'}
            </button>
          ) : (
            <button className="btn" onClick={() => window.print()}>
              Print {cards.length} cards
            </button>
          )}
        </div>
      </div>
      {cards && (
        <div className="lanyard-sheet">
          {cards.map((card) => (
            <LanyardCard key={card.registrationId} card={card} eventName={event.name} />
          ))}
        </div>
      )}
    </>
  );
}
