import { useId } from 'react';
import type { ReactNode } from 'react';
import type { Tone } from './Feedback';

/** Two to four options, one chosen: a radio group drawn as joined buttons. */
export function Segmented<T extends string>({ label, value, options, onChange, block }: { label: string; value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; block?: boolean }) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className={block ? 'segmented segmented-block' : 'segmented'}>
      {options.map((o) => (
        <label key={o.value}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

/** Filter tabs inside a page (days, views). Buttons with aria-pressed; the list below changes. */
export function FilterTabs<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A big count. As a filter it's a toggle button (aria-pressed). */
export function CountTile({ value, label, tone = 'neutral', pressed, onPress }: { value: number | string; label: string; tone?: Tone; pressed?: boolean; onPress?: () => void }) {
  const cls = `tile${tone !== 'neutral' ? ` tile-${tone}` : ''}`;
  const body = (
    <>
      <span className="tile-value">{value}</span>
      <span className="tile-label">{label}</span>
    </>
  );
  if (!onPress) return <div className={cls}>{body}</div>;
  return (
    <button type="button" className={cls} aria-pressed={!!pressed} onClick={onPress}>
      {body}
    </button>
  );
}

/** Numbered steps with the current one marked. */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="stepper" aria-label="Steps">
      {steps.map((s, i) => (
        <li key={s} aria-current={i === current ? 'step' : undefined} className={i < current ? 'is-done' : undefined}>
          <span className="stepper-mark" aria-hidden="true">
            {i < current ? '✓' : i + 1}
          </span>
          {s}
          {i < current && <span className="visually-hidden"> (done)</span>}
        </li>
      ))}
    </ol>
  );
}

/** A thin progress bar. Decorative: always show the numbers as text too. */
export function Progress({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <span className="progress" aria-hidden="true">
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}
