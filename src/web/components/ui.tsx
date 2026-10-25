import { cloneElement, isValidElement } from 'react';
import type { ReactNode } from 'react';
import type { EventStatus } from '../../shared/schemas';

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'ok' | 'warn' | 'stop'; title?: string; children?: ReactNode }) {
  const icon = { info: 'i', ok: '✓', warn: '!', stop: '×' }[tone];
  return (
    <div className={`notice notice-${tone}`} role={tone === 'stop' ? 'alert' : 'status'}>
      <span aria-hidden="true">
        <strong>{icon}</strong>
      </span>
      <div>
        {title && (
          <p>
            <strong>{title}</strong>
          </p>
        )}
        {children}
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<EventStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  completed: 'Completed',
  archived: 'Archived',
  cancelled: 'Cancelled',
};

export function EventStatusBadge({ status }: { status: EventStatus }) {
  return <span className={`status status-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  // Tie the hint and the error to the control, so screen readers read them
  // with the field and announce it as invalid.
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
  const control = isValidElement<Record<string, unknown>>(children)
    ? cloneElement(children, {
        'aria-describedby': [children.props['aria-describedby'], describedBy].filter(Boolean).join(' ') || undefined,
        'aria-invalid': error ? true : children.props['aria-invalid'],
      })
    : children;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <span className="field-hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
      {control}
      {error && (
        <span className="field-error" id={`${id}-error`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- skeletons

/**
 * A grey placeholder block the size of the content it stands in for, so
 * nothing moves when the data arrives. Decorative: wrap groups of them in
 * <Loading> (or another aria-busy region) so screen readers hear "Loading".
 */
export function Skeleton({ width = '100%', height = '1em', radius, className = '' }: { width?: string; height?: string; radius?: string; className?: string }) {
  return <span className={`skeleton ${className}`} style={{ width, height, borderRadius: radius }} aria-hidden="true" />;
}

/** Placeholder lines of text: a bold first line, then shorter muted lines. */
export function SkeletonText({ lines = 2, widths = ['55%', '35%', '45%'] }: { lines?: number; widths?: string[] }) {
  return (
    <span className="skeleton-text" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={widths[i % widths.length]} className={i === 0 ? 'skeleton-line-strong' : 'skeleton-line'} />
      ))}
    </span>
  );
}

/** Rows shaped like the app's grouped lists (.list > .list-row). */
export function SkeletonList({ rows = 5, lines = 2, aside = 'chevron', heading = false }: { rows?: number; lines?: number; aside?: 'chevron' | 'tag' | 'button' | 'none'; heading?: boolean }) {
  return (
    <div className="list-section" aria-hidden="true">
      {heading && <Skeleton width="8rem" height="0.9rem" className="skeleton-heading" />}
      <ul className="list">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="list-row">
            <SkeletonText lines={lines} widths={i % 2 ? ['45%', '60%'] : ['60%', '40%']} />
            {aside === 'chevron' && <Skeleton width="1.25rem" height="1.25rem" radius="4px" />}
            {aside === 'tag' && <Skeleton width="4.5rem" height="1.4rem" radius="6px" />}
            {aside === 'button' && <Skeleton width="5rem" height="2.5rem" radius="var(--radius-control)" />}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Stat tiles, as on the Live board and activity rosters. */
export function SkeletonTiles({ count = 3 }: { count?: number }) {
  return (
    <div className={count === 2 ? 'tiles tiles-2' : 'tiles'} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="tile">
          <Skeleton width="2.5rem" height="2.2rem" radius="6px" />
          <Skeleton width="70%" height="0.9rem" />
        </div>
      ))}
    </div>
  );
}

/** A page or section heading with its one-line description. */
export function SkeletonHeading({ sub = true, width = '14rem' }: { sub?: boolean; width?: string }) {
  return (
    <div className="skeleton-head" aria-hidden="true">
      <Skeleton width={width} height="2rem" radius="6px" />
      {sub && <Skeleton width="11rem" height="1rem" />}
    </div>
  );
}

/**
 * A loading region: announces "Loading…" to screen readers (aria-busy plus a
 * polite status) and shows skeletons shaped like the content. With no
 * children it shows a generic list.
 */
export function Loading({ label = 'Loading', children }: { label?: string; children?: ReactNode }) {
  return (
    <div className="loading" aria-busy="true">
      <span className="visually-hidden" role="status">
        {label}…
      </span>
      {children ?? <SkeletonList />}
    </div>
  );
}

const dateFormat = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function formatDateRange(startsOn: string, endsOn: string): string {
  const a = dateFormat.format(new Date(`${startsOn}T00:00:00Z`));
  if (startsOn === endsOn) return a;
  return `${a} to ${dateFormat.format(new Date(`${endsOn}T00:00:00Z`))}`;
}
