import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import type { Tone } from './Feedback';

/**
 * Shared building blocks for the organiser pages, so every page filters,
 * selects, warns and explains things the same way.
 */

/** A small (i) that shows a short explanation on hover, focus or tap, instead of a paragraph on the page. */
export function InfoTip({ children, label = 'More information' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <span className={open ? 'infotip is-open' : 'infotip'} ref={root}>
      <button type="button" className="infotip-button" aria-label={label} aria-describedby={id} aria-expanded={open} onClick={() => setOpen((o) => !o)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
        <Icon name="info" size={16} />
      </button>
      <span role="tooltip" id={id} className="infotip-body">
        {children}
      </span>
    </span>
  );
}

const BANNER_ICON: Record<'info' | 'success' | 'warning' | 'error', IconName> = { info: 'info', success: 'success', warning: 'warning', error: 'error' };

/** A one-line warning, error or note with its action on the right ("Fix", "Issue 7"). Noticeable, but compact. */
export function Banner({ tone = 'info', children, action, onDismiss }: { tone?: 'info' | 'success' | 'warning' | 'error'; children: ReactNode; action?: ReactNode; onDismiss?: () => void }) {
  return (
    <div className={`banner-line banner-line-${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      <Icon name={BANNER_ICON[tone]} size={18} />
      <div className="banner-line-text">{children}</div>
      {action && <div className="banner-line-action">{action}</div>}
      {onDismiss && (
        <button type="button" className="banner-line-close" aria-label="Dismiss" onClick={onDismiss}>
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}

/** The row above a list: search, filters, sort and view controls. Sticky keeps it in reach on long lists. */
export function Toolbar({ children, sticky = false, label }: { children: ReactNode; sticky?: boolean; label?: string }) {
  return (
    <div className={sticky ? 'toolbar toolbar-sticky' : 'toolbar'} role="toolbar" aria-label={label ?? 'Filters'}>
      {children}
    </div>
  );
}

export interface ChipOption<T extends string> {
  value: T;
  label: ReactNode;
  count?: number;
}

/**
 * Filter chips with counts. `multi`: any number on (none on means everything);
 * otherwise exactly one, like tabs.
 */
export function FilterChips<T extends string>(
  props: { label: string; options: ChipOption<T>[] } & ({ multi: true; value: T[]; onChange: (v: T[]) => void } | { multi?: false; value: T; onChange: (v: T) => void }),
) {
  const { label, options } = props;
  const on = (v: T) => (props.multi ? props.value.includes(v) : props.value === v);
  const press = (v: T) => {
    if (props.multi) props.onChange(on(v) ? props.value.filter((x) => x !== v) : [...props.value, v]);
    else props.onChange(v);
  };
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className="chip" aria-pressed={on(o.value)} onClick={() => press(o.value)}>
          {props.multi && on(o.value) && <Icon name="check" size={14} />}
          <span>{o.label}</span>
          {o.count !== undefined && <span className="chip-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Compact counts across the top of a page. Pressable ones filter the page. */
export function StatStrip({ items }: { items: { label: string; value: number | string; tone?: Tone; pressed?: boolean; onPress?: () => void; hint?: string }[] }) {
  return (
    <div className="stats" role="group" aria-label="Summary">
      {items.map((s) => {
        const cls = `stat${s.tone && s.tone !== 'neutral' ? ` stat-${s.tone}` : ''}`;
        const body = (
          <>
            <span className="stat-value">{s.value}</span>
            <span className="stat-label">{s.label}</span>
          </>
        );
        return s.onPress ? (
          <button key={s.label} type="button" className={cls} aria-pressed={!!s.pressed} onClick={s.onPress} title={s.hint}>
            {body}
          </button>
        ) : (
          <div key={s.label} className={cls} title={s.hint}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** Shown while anything is selected: how many, clear, and the actions for them. Stays on screen as the list scrolls. */
export function SelectionBar({ count, noun = 'selected', onClear, children }: { count: number; noun?: string; onClear: () => void; children?: ReactNode }) {
  if (count === 0) return null;
  return (
    <div className="selection-bar" role="region" aria-label="Selection">
      <span className="selection-count" aria-live="polite">
        <strong>{count}</strong> {noun}
      </span>
      <button type="button" className="link-button" onClick={onClear}>
        Clear
      </button>
      <div className="selection-actions">{children}</div>
    </div>
  );
}

/** An on/off switch with a short label. */
export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className="toggle">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true" />
      <span className="toggle-text">
        <span>{label}</span>
        {hint && <span className="meta">{hint}</span>}
      </span>
    </label>
  );
}

/** A button that opens a small panel (secondary filters and options). Escape or a click outside closes it. */
export function Popover({ button, label, children, align = 'start', icon }: { button: ReactNode; label: string; children: ReactNode; align?: 'start' | 'end'; icon?: IconName }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div className="popover" ref={root}>
      <button ref={btn} type="button" className="btn btn-secondary btn-small popover-button" aria-expanded={open} aria-controls={id} aria-label={label} onClick={() => setOpen((o) => !o)}>
        {icon && <Icon name={icon} size={18} />}
        {button}
        <Icon name="down" size={16} />
      </button>
      {open && (
        <div className={`popover-panel popover-${align}`} id={id} role="dialog" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * State kept for this browser tab (filters, sort, view), so coming back to
 * a page finds it as it was left. Session storage only: nothing personal.
 */
export function useRemembered<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const storageKey = `cc-ui:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T | ((prev: T) => T)) =>
      setValue((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // Storage full or blocked: it just isn't remembered.
        }
        return next;
      }),
    [storageKey],
  );
  return [value, set];
}

/** Press "/" anywhere (outside a text box) to jump to this search box. */
export function useSlashFocus(ref: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      e.preventDefault();
      ref.current?.focus();
      ref.current?.select();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ref]);
}
