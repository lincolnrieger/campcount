import { useState } from 'react';
import { Badge, Button, SearchField } from '../ui';
import { matchesSearch } from '../../shared/search';
import { dayInZone, dayLabel, timeRange } from '../../shared/time';
import type { ParticipantTeamEvent } from './TeamsPanel';

export interface SignupSession {
  id: string;
  name: string;
  location: string;
  startsAt: string | null;
  endsAt: string | null;
  capacity: number | null;
  booked: number;
  full: boolean;
}

export interface SignupView {
  pass: string;
  person: { name: string; groupName: string };
  event: { name: string; timezone: string; startsOn: string; endsOn: string };
  open: boolean;
  sessions: SignupSession[];
  bookings: { activityId: string; name: string; location: string; startsAt: string | null; endsAt: string | null; canCancel: boolean }[];
  /** The whole camp programme (activities, meals and programme items). */
  programme?: ProgrammeItem[];
  /** Team events (Soccer, Basketball…) and the person's own teams. */
  teamEvents?: ParticipantTeamEvent[];
}

export interface ProgrammeItem {
  name: string;
  location: string;
  startsAt: string | null;
  endsAt: string | null;
  kind: 'activity' | 'meal' | 'program';
  bookingRequired: boolean;
}

export function placesLeft(s: SignupSession): string {
  if (s.capacity === null) return 'Open';
  const left = s.capacity - s.booked;
  return left <= 0 ? 'Full' : `${left} place${left === 1 ? '' : 's'} left`;
}

/** Sessions grouped by day, for the sign-up screen and its dashboard. */
export function SessionBoard({
  sessions,
  tz,
  booked = new Set(),
  highlight,
  busy,
  onBook,
}: {
  sessions: SignupSession[];
  tz: string;
  booked?: Set<string>;
  highlight?: string | null;
  busy?: boolean;
  onBook?: (s: SignupSession) => void;
}) {
  const days = new Map<string, SignupSession[]>();
  for (const s of sessions) {
    const key = s.startsAt ? dayInZone(s.startsAt, tz) : '';
    days.set(key, [...(days.get(key) ?? []), s]);
  }
  if (sessions.length === 0) return <p className="meta">No activities are open for sign-up yet.</p>;
  return (
    <>
      {[...days].map(([day, list]) => (
        <section key={day} className="section">
          <h3>{day ? dayLabel(day, 'long') : 'Any time'}</h3>
          <ul className="list">
            {list.map((s) => {
              const isBooked = booked.has(s.id);
              return (
                <li key={s.id} className={s.id === highlight ? 'row is-highlight' : 'row'}>
                  <span className="row-main">
                    <span className="row-title">{s.name}</span>
                    <span className="row-meta">{[s.startsAt ? timeRange(s.startsAt, s.endsAt, tz) : null, s.location || null].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="row-side">
                    {onBook ? (
                      isBooked ? (
                        <Badge tone="success" icon>
                          Booked
                        </Badge>
                      ) : s.full ? (
                        <Badge>Full</Badge>
                      ) : (
                        <Button kind="primary" disabled={busy} onClick={() => onBook(s)}>
                          Book<span className="visually-hidden"> {s.name}</span>
                        </Button>
                      )
                    ) : (
                      <Badge tone={s.full ? 'neutral' : 'success'}>{placesLeft(s)}</Badge>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

/** One identified person: their bookings and everything they can book. */
export function SignupPanel({
  view,
  highlight,
  busy,
  onBook,
  onCancel,
}: {
  view: SignupView;
  highlight?: string | null;
  busy: boolean;
  onBook: (s: SignupSession) => void;
  onCancel: (activityId: string) => void;
}) {
  const [q, setQ] = useState('');
  const tz = view.event.timezone;
  const booked = new Set(view.bookings.map((b) => b.activityId));
  const wanted = highlight ? view.sessions.find((s) => s.id === highlight) : null;
  const shown = view.sessions.filter((s) => matchesSearch(q, s.name, s.location));
  return (
    <>
      {wanted && !booked.has(wanted.id) && (
        <div className="panel panel-pad wanted stack">
          <p>
            <strong>{wanted.name}</strong>
            {wanted.startsAt && `, ${timeRange(wanted.startsAt, wanted.endsAt, tz)}`}
          </p>
          {wanted.full ? (
            <p>This session is full. Pick another below.</p>
          ) : (
            <Button kind="primary" block disabled={busy} onClick={() => onBook(wanted)}>
              Book {wanted.name} for {view.person.name}
            </Button>
          )}
        </div>
      )}

      <section className="section">
        <h2>{view.person.name}'s activities</h2>
        {view.bookings.length === 0 ? (
          <p className="meta">Nothing booked yet.</p>
        ) : (
          <ul className="list">
            {view.bookings.map((b) => (
              <li key={b.activityId} className="row">
                <span className="row-main">
                  <span className="row-title">{b.name}</span>
                  <span className="row-meta">
                    {[b.startsAt ? `${dayLabel(dayInZone(b.startsAt, tz))}, ${timeRange(b.startsAt, b.endsAt, tz)}` : null, b.location || null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="row-side">
                  {b.canCancel ? (
                    <Button disabled={busy} onClick={() => onCancel(b.activityId)}>
                      Cancel booking<span className="visually-hidden"> for {b.name}</span>
                    </Button>
                  ) : (
                    <span className="meta">Booked by leaders</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {view.open ? (
        <section className="section">
          <h2>Book an activity</h2>
          <SearchField id="signup-q" label="Search activities" placeholder="Type an activity, for example kayak" value={q} onChange={setQ} />
          <SessionBoard sessions={shown} tz={tz} booked={booked} highlight={highlight} busy={busy} onBook={onBook} />
        </section>
      ) : (
        <p className="meta">Activity sign-up isn't open right now.</p>
      )}
    </>
  );
}
