import { useState } from 'react';
import { Badge, Button, FilterTabs, SearchField } from '../ui';
import { matchesSearch } from '../../shared/search';
import { dayInZone, dayLabel, timeInZone, timeRange, todayInZone } from '../../shared/time';
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
  /** Activities: the place limit (null when there isn't one) and how many are booked. */
  capacity: number | null;
  booked: number;
  /** Meals: what's served and what goes into it. */
  menu?: string;
  ingredients?: string;
}

export function placesLeft(s: SignupSession): string {
  if (s.capacity === null) return 'Open';
  const left = s.capacity - s.booked;
  return left <= 0 ? 'Full' : `${left} place${left === 1 ? '' : 's'} left`;
}

/** "8 of 12 booked" with a fill bar, or "8 booked" when there's no limit. */
export function Spots({ s }: { s: SignupSession }) {
  if (s.capacity === null) return <span className="spots">{s.booked === 0 ? 'No one booked yet' : `${s.booked} booked`}</span>;
  const left = s.capacity - s.booked;
  return (
    <span className={left <= 0 ? 'spots is-full' : left <= 2 ? 'spots is-low' : 'spots'}>
      <span className="num">
        {Math.min(s.booked, s.capacity)} of {s.capacity} booked
        {left > 0 && left <= 2 ? ` · ${left} left` : ''}
      </span>
      <span className="spots-bar" aria-hidden="true">
        <span style={{ width: `${Math.min(100, (s.booked / s.capacity) * 100)}%` }} />
      </span>
    </span>
  );
}

const ANY_DAY = 'any';

/** Sessions for one day at a time (day tabs when there's more than one), each with its spots and a Book button. */
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
  const days = [...new Set(sessions.map((s) => (s.startsAt ? dayInZone(s.startsAt, tz) : ANY_DAY)))].sort((a, b) => (a === ANY_DAY ? 1 : b === ANY_DAY ? -1 : a.localeCompare(b)));
  const today = todayInZone(tz);
  const wantedDay = highlight ? sessions.find((s) => s.id === highlight) : null;
  const [chosen, setChosen] = useState<string | null>(null);
  const day =
    chosen && days.includes(chosen)
      ? chosen
      : wantedDay
        ? wantedDay.startsAt
          ? dayInZone(wantedDay.startsAt, tz)
          : ANY_DAY
        : days.includes(today)
          ? today
          : (days.find((d) => d !== ANY_DAY && d > today) ?? days[0] ?? ANY_DAY);
  if (sessions.length === 0) return <p className="meta">No activities are open for sign-up yet.</p>;
  const list = sessions.filter((s) => (s.startsAt ? dayInZone(s.startsAt, tz) : ANY_DAY) === day);
  return (
    <div className="session-board">
      {days.length > 1 && (
        <FilterTabs
          label="Day"
          value={day}
          onChange={setChosen}
          options={days.map((d) => ({ value: d, label: d === ANY_DAY ? 'Any time' : d === today ? 'Today' : dayLabel(d) }))}
        />
      )}
      <ul className="session-list">
        {list.map((s) => {
          const isBooked = booked.has(s.id);
          return (
            <li key={s.id} className={['session', s.id === highlight ? 'is-highlight' : '', isBooked ? 'is-booked' : ''].join(' ').trim()}>
              <span className="session-time num">{s.startsAt ? timeInZone(s.startsAt, tz) : 'Any time'}</span>
              <span className="session-main">
                <span className="row-title">{s.name}</span>
                <span className="row-meta">{[s.startsAt && s.endsAt ? `until ${timeInZone(s.endsAt, tz)}` : null, s.location || null].filter(Boolean).join(' · ')}</span>
                <Spots s={s} />
              </span>
              <span className="session-action">
                {onBook &&
                  (isBooked ? (
                    <Badge tone="success" icon>
                      Booked
                    </Badge>
                  ) : s.full ? (
                    <Badge>Full</Badge>
                  ) : (
                    <Button kind="primary" disabled={busy} onClick={() => onBook(s)}>
                      Book<span className="visually-hidden"> {s.name}</span>
                    </Button>
                  ))}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One identified person: what they've booked, then everything they can book. */
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
  const mine = [...view.bookings].sort((a, b) => (a.startsAt ?? '9').localeCompare(b.startsAt ?? '9'));
  return (
    <>
      {wanted && !booked.has(wanted.id) && (
        <div className="panel panel-pad wanted stack">
          <p>
            <strong>{wanted.name}</strong>
            {wanted.startsAt && `, ${dayLabel(dayInZone(wanted.startsAt, tz))} ${timeRange(wanted.startsAt, wanted.endsAt, tz)}`}
          </p>
          <Spots s={wanted} />
          {wanted.full ? (
            <p>This session is full. Pick another below.</p>
          ) : (
            <Button kind="primary" block disabled={busy} onClick={() => onBook(wanted)}>
              Book {wanted.name}
            </Button>
          )}
        </div>
      )}

      <section className="signup-section" aria-labelledby="mine-heading">
        <h2 id="mine-heading">{mine.length ? `Booked (${mine.length})` : 'Booked'}</h2>
        {mine.length === 0 ? (
          <p className="meta">Nothing yet. Pick something below.</p>
        ) : (
          <ul className="session-list">
            {mine.map((b) => (
              <li key={b.activityId} className="session is-booked">
                <span className="session-time num">{b.startsAt ? timeInZone(b.startsAt, tz) : 'Any time'}</span>
                <span className="session-main">
                  <span className="row-title">{b.name}</span>
                  <span className="row-meta">{[b.startsAt ? dayLabel(dayInZone(b.startsAt, tz)) : null, b.location || null].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="session-action">
                  {b.canCancel ? (
                    <Button small kind="ghost" disabled={busy} onClick={() => onCancel(b.activityId)}>
                      Cancel<span className="visually-hidden"> {b.name}</span>
                    </Button>
                  ) : (
                    <span className="meta">Set by leaders</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {view.open ? (
        <section className="signup-section" aria-labelledby="book-heading">
          <h2 id="book-heading">Book an activity</h2>
          {view.sessions.length > 10 && <SearchField id="signup-q" label="Search activities" placeholder="For example, kayak" value={q} onChange={setQ} />}
          <SessionBoard sessions={shown} tz={tz} booked={booked} highlight={highlight} busy={busy} onBook={onBook} />
        </section>
      ) : (
        <p className="meta">Activity sign-up isn't open right now.</p>
      )}
    </>
  );
}
