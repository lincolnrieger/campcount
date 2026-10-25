import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from './Icon';

export type MenuItem =
  | { label: string; to: string; danger?: false }
  | { label: string; onSelect: () => void; danger?: boolean };

/**
 * The ⋯ overflow menu for secondary actions. A disclosure (button plus a
 * list of ordinary links and buttons), so it works with every screen reader
 * without menu-role key handling. Escape or a click outside closes it and
 * returns focus to the ⋯ button. Destructive items are listed last, after
 * a divider.
 */
export function Menu({ label, items }: { label: string; items: (MenuItem | false | null | undefined)[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = items.filter(Boolean) as MenuItem[];
  const safe = list.filter((i) => !i.danger);
  const danger = list.filter((i) => i.danger);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('.menu-list a, .menu-list button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onFocus = (e: FocusEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('focusin', onFocus);
    };
  }, [open]);

  if (list.length === 0) return null;
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const render = (item: MenuItem) => (
    <li key={item.label}>
      {'to' in item ? (
        <Link to={item.to} onClick={() => setOpen(false)}>
          {item.label}
        </Link>
      ) : (
        <button
          type="button"
          className={item.danger ? 'is-danger' : undefined}
          onClick={() => {
            close();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      )}
    </li>
  );

  return (
    <div className="menu" ref={root}>
      <button ref={button} type="button" className="menu-button" aria-expanded={open} aria-controls={id} aria-label={label} onClick={() => setOpen(!open)}>
        <Icon name="more" size={20} />
      </button>
      <ul id={id} className="menu-list" hidden={!open}>
        {safe.map(render)}
        {danger.length > 0 && safe.length > 0 && <li className="menu-divider" aria-hidden="true" />}
        {danger.map(render)}
      </ul>
    </div>
  );
}
