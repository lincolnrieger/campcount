import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Button } from './Button';

/**
 * The Save bar at the bottom of a long settings form: it stays on screen as
 * the form scrolls, says whether anything has changed, and Ctrl+S (⌘S)
 * saves. Render it inside the <form>; Save is its submit button.
 */
export function SaveBar({
  dirty,
  busy,
  problems = 0,
  saveLabel = 'Save changes',
  onCancel,
  extra,
}: {
  dirty: boolean;
  busy: boolean;
  problems?: number;
  saveLabel?: string;
  onCancel: () => void;
  extra?: ReactNode;
}) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      if (!busy) bar.current?.closest('form')?.requestSubmit();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy]);
  return (
    <div className="save-bar" ref={bar}>
      <span className={problems ? 'save-bar-state is-error' : dirty ? 'save-bar-state is-dirty' : 'save-bar-state'} aria-live="polite">
        {problems ? `${problems} ${problems === 1 ? 'thing' : 'things'} to fix` : dirty ? 'Unsaved changes' : 'No changes yet'}
      </span>
      {extra}
      <span className="save-bar-keys" aria-hidden="true" title="Save with Ctrl+S">
        <kbd>Ctrl</kbd>+<kbd>S</kbd>
      </span>
      <Button onClick={onCancel}>Cancel</Button>
      <Button type="submit" kind="primary" busy={busy} busyLabel="Saving…">
        {saveLabel}
      </Button>
    </div>
  );
}
