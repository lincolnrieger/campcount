import { QrCode } from './QrCode';
import type { Card, CardSize } from '../lanyards/pdf';
import { SECTION_COLOURS, bandLabel } from '../lanyards/pdf';

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
