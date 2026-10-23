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
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <span className="field-hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
      {children}
      {error && (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <p className="lede" role="status">
      {label}…
    </p>
  );
}

const dateFormat = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function formatDateRange(startsOn: string, endsOn: string): string {
  const a = dateFormat.format(new Date(`${startsOn}T00:00:00Z`));
  if (startsOn === endsOn) return a;
  return `${a} to ${dateFormat.format(new Date(`${endsOn}T00:00:00Z`))}`;
}
