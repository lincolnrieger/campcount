import type { CSSProperties } from 'react';
import { QrCode } from './QrCode';
import type { Card, CardSize, PhotoMarkerStyle } from '../lanyards/pdf';
import { bandColours, bandLabel } from '../lanyards/pdf';

/** The crossed-out camera printed on cards of people without photo consent. */
export function NoCameraIcon({ size = '1em' }: { size?: string }) {
  return (
    <svg className="no-camera" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#fff" />
      <rect x="5" y="8" width="14" height="10" rx="1.5" fill="#000" />
      <rect x="9" y="6" width="6" height="3" rx="1" fill="#000" />
      <circle cx="12" cy="13" r="2.6" fill="#fff" />
      <path d="M4 20 20 4" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M4 20 20 4" stroke="#000" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** The marker for someone without photo consent, for the band. */
function Marker({ card, marker }: { card: Card; marker: PhotoMarkerStyle }) {
  if (!card.noPhotos) return null;
  const badge = marker.photoMarker === 'red_dot' ? <span className="card-dot" aria-hidden="true" /> : marker.photoMarker === 'camera_icon' ? <NoCameraIcon /> : null;
  if (!badge && !marker.photoMarkerLabel) return null;
  return (
    <span className="card-marker">
      {marker.photoMarkerLabel ? <span className="card-marker-text">No photos</span> : <span className="visually-hidden">No photos</span>}
      {badge}
    </span>
  );
}

function frameStyle(card: Card, marker: PhotoMarkerStyle): { className: string; style?: CSSProperties } {
  if (!card.noPhotos) return { className: '' };
  if (marker.photoMarker === 'black_border') return { className: ' has-frame', style: { '--frame': '#000' } as CSSProperties };
  if (marker.photoMarker === 'colour_border') return { className: ' has-frame', style: { '--frame': marker.photoMarkerColour } as CSSProperties };
  return { className: '' };
}

/** On-screen preview of one card's front, drawn to the same layout as the PDF. */
export function LanyardCard({ card, size = 'lanyard', marker }: { card: Card; size?: CardSize; marker: PhotoMarkerStyle }) {
  const colours = bandColours(card);
  const band = { background: colours.bg, color: colours.fg };
  const frame = frameStyle(card, marker);
  if (size === 'badge') {
    return (
      <article className={`card-preview card-badge${frame.className}`} style={frame.style}>
        <div className="card-band" style={band}>
          <span>{bandLabel(card)}</span>
          <Marker card={card} marker={marker} />
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
    <article className={`card-preview card-lanyard${frame.className}`} style={frame.style}>
      <div className="card-band" style={band}>
        <span>{bandLabel(card)}</span>
        <Marker card={card} marker={marker} />
      </div>
      <div className="card-body">
        <p className="card-name">{card.name}</p>
        <p className="card-group">{card.groupName}</p>
        <div className="card-qr">
          <QrCode value={card.qr} size="100%" label={`Scan code for ${card.name}`} />
        </div>
        <p className="card-code">{card.shortCode}</p>
      </div>
    </article>
  );
}

/** The back of a card: the camp's logo, its name and what to do if found. */
export function LanyardBack({ card, size = 'lanyard', marker, eventName, logoUrl }: { card: Card; size?: CardSize; marker: PhotoMarkerStyle; eventName: string; logoUrl: string | null }) {
  const frame = frameStyle(card, marker);
  return (
    <article className={`card-preview card-back card-back-${size}${frame.className}`} style={frame.style} aria-label={`Back of ${card.name}'s card`}>
      <div className="card-back-inner">
        {logoUrl && <img src={logoUrl} alt="" className="card-back-logo" />}
        <div>
          <p className="card-back-name">{eventName}</p>
          <p className="card-back-note">If found, please hand to a camp leader.</p>
        </div>
      </div>
    </article>
  );
}
