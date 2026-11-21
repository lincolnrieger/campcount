import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams } from 'react-router';
import { dayInZone, dayLabel, timeRange } from '../../shared/time';
import { ApiFailure, api } from '../api';
import { useTitle } from '../shell';
import { Button, Field, Icon, formatDateRange, plural } from '../ui';

interface LinkInfo {
  event: { name: string; timezone: string; startsOn: string; endsOn: string };
  open: boolean;
  session: { id: string; name: string; location: string; startsAt: string | null; endsAt: string | null; capacity: number | null; booked: number; full: boolean };
}

/**
 * One activity's booking page, from a link emailed before camp. Type a
 * membership number, book. Nothing about anyone is shown: only whether it
 * worked.
 */
export function BookLink() {
  const { code, activityId } = useParams() as { code: string; activityId: string };
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [missing, setMissing] = useState(false);
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
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
      const res = await api<{ already: boolean; activity: string }>(`/public/signup/link/${code}/${activityId}`, { body: { memberNumber: number.trim() } });
      setResult({ ok: true, text: res.already ? `Already booked for ${res.activity}.` : `Booked for ${res.activity}. See you there!` });
      setNumber('');
    } catch (err) {
      setResult({ ok: false, text: err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.' });
    } finally {
      setBusy(false);
    }
  }

  const s = info?.session;
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
            {!info.open ? (
              <p className="book-link-msg">Booking is closed right now.</p>
            ) : s.full ? (
              <p className="book-link-msg">This activity is full.</p>
            ) : (
              <form onSubmit={book} className="form" noValidate>
                <Field id="book-number" label="Membership number" hint="On your Scouts card or in MyScout. Book for one person at a time.">
                  <input className="input book-link-input" inputMode="numeric" autoComplete="off" maxLength={24} value={number} onChange={(e) => setNumber(e.target.value)} />
                </Field>
                <Button type="submit" kind="primary" busy={busy} busyLabel="Booking…" disabled={!number.trim()}>
                  Book {s.name}
                </Button>
                {s.capacity !== null && <p className="meta">{plural(Math.max(0, s.capacity - s.booked), 'place')} left</p>}
              </form>
            )}
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
