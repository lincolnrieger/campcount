import { useState } from 'react';
import { matchesSearch } from '../../shared/search';
import { dayInZone, dayLabel, timeRange } from '../../shared/time';

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
  if (sessions.length === 0) return <p className="field-hint">No activities are open for sign-up yet.</p>;
  return (
    <>
      {[...days].map(([day, list]) => (
        <section key={day} className="list-section">
          <h3 className="list-heading">{day ? dayLabel(day, 'long') : 'Any time'}</h3>
          <ul className="list">
            {list.map((s) => {
              const isBooked = booked.has(s.id);
              return (
                <li key={s.id} className={s.id === highlight ? 'is-highlight' : undefined}>
                  <div className="list-row session-row">
                    <span className="list-main">
                      <strong>{s.name}</strong>
                      <span>{[s.startsAt ? timeRange(s.startsAt, s.endsAt, tz) : null, s.location || null].filter(Boolean).join(', ')}</span>
                    </span>
                    {onBook ? (
                      isBooked ? (
                        <span className="tag tag-now">Booked</span>
                      ) : s.full ? (
                        <span className="tag">Full</span>
                      ) : (
                        <button className="btn btn-small" disabled={busy} onClick={() => onBook(s)}>
                          Book<span className="visually-hidden"> {s.name}</span>
                        </button>
                      )
                    ) : (
                      <span className={s.full ? 'tag' : 'tag tag-places'}>{placesLeft(s)}</span>
                    )}
                  </div>
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
        <div className="wanted">
          <p className="flush">
            <strong>{wanted.name}</strong>
            {wanted.startsAt && `, ${timeRange(wanted.startsAt, wanted.endsAt, tz)}`}
          </p>
          {wanted.full ? (
            <p className="flush">This session is full. Pick another below.</p>
          ) : (
            <button className="btn btn-block" disabled={busy} onClick={() => onBook(wanted)}>
              Book {wanted.name} for {view.person.name}
            </button>
          )}
        </div>
      )}

      <section className="list-section">
        <h3 className="list-heading">{view.person.name}'s activities</h3>
        {view.bookings.length === 0 ? (
          <p className="field-hint">Nothing booked yet.</p>
        ) : (
          <ul className="list">
            {view.bookings.map((b) => (
              <li key={b.activityId} className="list-row">
                <span className="list-main">
                  <strong>{b.name}</strong>
                  <span>
                    {[b.startsAt ? `${dayLabel(dayInZone(b.startsAt, tz))}, ${timeRange(b.startsAt, b.endsAt, tz)}` : null, b.location || null]
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                </span>
                {b.canCancel ? (
                  <button className="btn-link" disabled={busy} onClick={() => onCancel(b.activityId)}>
                    Cancel<span className="visually-hidden"> {b.name}</span>
                  </button>
                ) : (
                  <span className="field-hint">Booked by leaders</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {view.open ? (
        <section className="list-section">
          <h3 className="list-heading">Book an activity</h3>
          <input className="input" type="search" placeholder="Type an activity, for example kayak" aria-label="Search activities" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="section-gap-sm">
            <SessionBoard sessions={shown} tz={tz} booked={booked} highlight={highlight} busy={busy} onBook={onBook} />
          </div>
        </section>
      ) : (
        <p className="field-hint">Activity sign-up isn't open right now.</p>
      )}
    </>
  );
}
