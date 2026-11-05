import { useId } from 'react';
import { Button, Icon, useToast } from '../ui';

/** A one-time link to hand to someone: copy it, or share it straight to a message app. */
export function LinkShare({ link, expiresAt, label, onEmail, emailBusy }: { link: string; expiresAt: string; label: string; onEmail?: () => void; emailBusy?: boolean }) {
  const toast = useToast();
  const id = useId();
  const expires = new Date(expiresAt).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Adelaide' });
  const canShare = typeof navigator.share === 'function';
  return (
    <div className="stack">
      <div className="field">
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
        <span className="field-hint" id={`${id}-hint`}>
          Works once. Expires {expires}. Send it only to them: anyone with it can set the password.
        </span>
        <input id={id} className="input" readOnly value={link} aria-describedby={`${id}-hint`} onFocus={(e) => e.target.select()} />
      </div>
      <div className="btn-row">
        <Button
          kind="primary"
          onAction={async () => {
            try {
              await navigator.clipboard.writeText(link);
              toast('Link copied');
            } catch {
              toast("Couldn't copy. Select the link and copy it yourself.", { tone: 'error' });
            }
          }}
        >
          <Icon name="copy" />
          Copy link
        </Button>
        {canShare && <Button onClick={() => void navigator.share({ title: 'CampCount', url: link }).catch(() => undefined)}>Share…</Button>}
        {onEmail && (
          <Button busy={emailBusy} busyLabel="Sending…" onClick={onEmail}>
            Email them instead
          </Button>
        )}
      </div>
    </div>
  );
}
