import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams } from 'react-router';
import { dayInZone, dayLabel, timeRange } from '../../shared/time';
import { ApiFailure, api } from '../api';
import { useTitle } from '../shell';
import { Button, Field, Icon, formatDateRange, plural } from '../ui';
import type { SignupView } from '../components/SignupPanel';
import { ParticipantPage } from './Participant';
import { usePerson } from './Signup';

interface LinkInfo {
  event: { name: string; timezone: string; startsOn: string; endsOn: string; contactEmail?: string };
  open: boolean;
  session: { id: string; name: string; location: string; startsAt: string | null; endsAt: string | null; capacity: number | null; booked: number; full: boolean };
}

/**
 * One activity's booking page, from a link emailed before camp. Type a
 * participant ID, book. Nothing about anyone is shown: only whether it
 * worked.
 */
export function BookLink() {
  const { code, activityId } = useParams() as { code: string; activityId: string };
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [missing, setMissing] = useState(false);
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const person = usePerson(setError);
  const { setView } = person;
  useTitle(info ? `Book ${info.session.name}` : 'Book an activity');

  useEffect(() => {
    api<LinkInfo>(`/public/signup/link/${code}/${activityId}`)
      .then(setInfo)
      .catch(() => setMissing(true));
  }, [code, activityId]);

  async function book(e: FormEvent) {
    e.preventDefault();
    if (!number.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await api<SignupView & { linkResult: { booked: boolean; already: boolean; activity: string | null; problem: string | null } }>(`/public/signup/link/${code}/${activityId}`, {
        body: { participantId: number.trim() },
      });
      const r = res.linkResult;
      // Their own page from here: everything they're booked for, and cancel.
      setView(res);
      setResult(r.booked ? { ok: true, text: r.already ? `You were already booked for ${r.activity}.` : `Booked for ${r.activity}. See you there!` } : { ok: false, text: r.problem ?? 'That couldn’t be booked.' });
      setNumber('');
    } catch (err) {
      setResult({ ok: false, text: err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.' });
    } finally {
      setBusy(false);
    }
  }

  const s = info?.session;
  if (person.view) return <ParticipantPage view={person.view} busy={person.busy} actions={person} error={error} notice={result} />;
  return (
    <main className="public" id="main">
      <div className="public-card book-link">
        {missing ? (
          <>
            <h1>This link isn’t working</h1>
            <p className="meta">It may be old, or the activity is no longer taking bookings. Ask your leader for a new link.</p>
          </>
        ) : !info || !s ? (
          <p className="meta">Loading…</p>
        ) : (
          <>
            <p className="meta">
              {info.event.name} · {formatDateRange(info.event.startsOn, info.event.endsOn)}
            </p>
            <h1>{s.name}</h1>
            <p className="book-link-when">
              {[s.startsAt ? `${dayLabel(dayInZone(s.startsAt, info.event.timezone), 'long')}, ${timeRange(s.startsAt, s.endsAt, info.event.timezone)}` : 'Any time', s.location]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {!info.open ? <p className="book-link-msg">Booking is closed right now.</p> : s.full ? <p className="book-link-msg">This activity is full.</p> : null}
            <form onSubmit={book} className="form" noValidate>
              <Field id="book-number" label="Participant ID">
                <input className="input book-link-input" inputMode="numeric" autoComplete="off" maxLength={24} value={number} onChange={(e) => setNumber(e.target.value)} />
              </Field>
              <Button type="submit" kind="primary" busy={busy} busyLabel="Opening…" disabled={!number.trim()}>
                {info.open && !s.full ? `Book ${s.name}` : 'See my bookings'}
              </Button>
              {info.open && !s.full && s.capacity !== null && <p className="meta">{plural(Math.max(0, s.capacity - s.booked), 'place')} left</p>}
              {info.event.contactEmail && (
                <p className="meta">
                  If you would like to change a booking, please email <a href={`mailto:${info.event.contactEmail}`}>{info.event.contactEmail}</a>.
                </p>
              )}
            </form>
            {result && (
              <p className={result.ok ? 'book-link-result is-ok' : 'book-link-result is-error'} role="status">
                <Icon name={result.ok ? 'success' : 'error'} size={20} />
                {result.text}
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
