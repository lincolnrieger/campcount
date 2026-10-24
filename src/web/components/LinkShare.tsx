import { useState } from 'react';

/** A one-time link to hand to someone: copy it, or share it straight to a message app. */
export function LinkShare({ link, expiresAt, label, onEmail, emailBusy }: { link: string; expiresAt: string; label: string; onEmail?: () => void; emailBusy?: boolean }) {
  const [copied, setCopied] = useState(false);
  const expires = new Date(expiresAt).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Adelaide' });
  const canShare = typeof navigator.share === 'function';
  return (
    <div className="link-share">
      <label className="field-legend" htmlFor="share-link">
        {label}
      </label>
      <input id="share-link" className="input input-compact link-share-input" readOnly value={link} onFocus={(e) => e.target.select()} />
      <p className="field-hint flush">Works once. Expires {expires}. Only send it to them directly: anyone with it can set the password.</p>
      <div className="actions flush-top">
        <button
          type="button"
          className="btn btn-small"
          onClick={() => {
            void navigator.clipboard?.writeText(link).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
        {canShare && (
          <button type="button" className="btn btn-secondary btn-small" onClick={() => void navigator.share({ title: 'CampCount', url: link }).catch(() => undefined)}>
            Share…
          </button>
        )}
        {onEmail && (
          <button type="button" className="btn btn-secondary btn-small" disabled={emailBusy} onClick={onEmail}>
            Email them instead
          </button>
        )}
      </div>
    </div>
  );
}
