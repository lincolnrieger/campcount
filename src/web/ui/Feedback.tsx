import type { ReactNode } from 'react';
import type { ApiFailure } from '../api';
import { Button } from './Button';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export type Tone = 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'brand';

const TONE_ICON: Partial<Record<Tone, IconName>> = { success: 'check', warning: 'warning', error: 'cross', info: 'info' };

/** A short status label. Always has words; the colour is extra. */
export function Badge({ tone = 'neutral', icon = false, children }: { tone?: Tone; icon?: boolean; children: ReactNode }) {
  const name = TONE_ICON[tone];
  return (
    <span className={tone === 'neutral' ? 'badge' : `badge badge-${tone}`}>
      {icon && name && <Icon name={name} size={16} />}
      {children}
    </span>
  );
}

const NOTICE_ICON: Record<'info' | 'success' | 'warning' | 'error', IconName> = { info: 'info', success: 'success', warning: 'warning', error: 'error' };

/** An inline message box. Errors are announced (role=alert); others are not live unless `live`. */
export function Notice({ tone = 'info', title, children, live }: { tone?: 'info' | 'success' | 'warning' | 'error'; title?: ReactNode; children?: ReactNode; live?: boolean }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : live ? 'status' : undefined}>
      <Icon name={NOTICE_ICON[tone]} />
      <div className="notice-body">
        {title && <p className="notice-title">{title}</p>}
        {children}
      </div>
    </div>
  );
}

/** A failed load: what went wrong, in plain words, and Try again. */
export function LoadError({ error, onRetry, what = 'this', message }: { error: ApiFailure; onRetry?: () => unknown; what?: string; message?: string }) {
  const text =
    message ??
    (error.status === 0
      ? 'No connection. Check your signal and try again.'
      : error.status === 403
        ? "You don't have access to this."
        : error.status === 404
          ? "This doesn't exist any more, or you're not on its staff."
          : error.status >= 500
            ? 'CampCount had a problem. Try again in a moment.'
            : error.message);
  return (
    <Notice tone="error" title={`Couldn't load ${what}`}>
      <p>{text}</p>
      {onRetry && error.status !== 403 && error.status !== 404 && (
        <Button small onAction={onRetry} busyLabel="Trying again…">
          Try again
        </Button>
      )}
    </Notice>
  );
}

/** Nothing here yet: say so, and offer the next step. */
export function EmptyState({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <p>{children}</p>}
      {actions && <div className="btn-row">{actions}</div>}
    </div>
  );
}

/** A grey block the size of what it stands in for. */
export function Skeleton({ width = '100%', height, className = 'skeleton-line' }: { width?: string; height?: string; className?: string }) {
  return <span className={`skeleton ${className}`} style={{ width, height }} aria-hidden="true" />;
}

/**
 * A loading region: aria-busy plus a hidden "Loading …" for screen readers,
 * and skeletons shaped like the content (or rows by default).
 */
export function Loading({ what, children, rows = 5 }: { what: string; children?: ReactNode; rows?: number }) {
  return (
    <div aria-busy="true" className="stack">
      <span className="visually-hidden" role="status">
        Loading {what}…
      </span>
      {children ?? <SkeletonRows rows={rows} />}
    </div>
  );
}

export function SkeletonRows({ rows = 5, action = false }: { rows?: number; action?: boolean }) {
  return (
    <ul className="list" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="row">
          <span className="row-main">
            <Skeleton width={i % 2 ? '45%' : '60%'} />
            <Skeleton width={i % 2 ? '30%' : '38%'} className="skeleton-line-sm" />
          </span>
          {action && <Skeleton width="5.5rem" height="var(--control)" className="" />}
        </li>
      ))}
    </ul>
  );
}

export function SkeletonHeader() {
  return (
    <div className="page-header" aria-hidden="true">
      <Skeleton className="skeleton-title" />
      <Skeleton width="12rem" className="skeleton-line-sm" />
    </div>
  );
}

export function SkeletonTiles({ count = 3 }: { count?: number }) {
  return (
    <div className={count === 2 ? 'tiles tiles-2' : 'tiles'} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="tile">
          <Skeleton width="3rem" height="var(--text-display)" className="" />
          <Skeleton width="70%" className="skeleton-line-sm" />
        </div>
      ))}
    </div>
  );
}
