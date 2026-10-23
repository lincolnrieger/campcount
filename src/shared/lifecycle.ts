import type { EventStatus } from './schemas';

/**
 * Allowed event status transitions.
 *
 *   draft ──► open ──► completed ──► archived
 *     │        ▲  │        │
 *     │        └──┼────────┘ (reopen, for late corrections)
 *     └──► cancelled ◄─┘
 */
export const EVENT_TRANSITIONS: Record<EventStatus, readonly EventStatus[]> = {
  draft: ['open', 'cancelled'],
  open: ['completed', 'cancelled'],
  completed: ['open', 'archived'],
  archived: [],
  cancelled: ['draft'],
};

export function canTransition(from: EventStatus, to: EventStatus): boolean {
  return EVENT_TRANSITIONS[from].includes(to);
}

/** Scanning and live operations only happen while an event is open. */
export function isOperational(status: EventStatus): boolean {
  return status === 'open';
}

/** Configuration and roster changes are allowed until the event is completed. */
export function isEditable(status: EventStatus): boolean {
  return status === 'draft' || status === 'open';
}
