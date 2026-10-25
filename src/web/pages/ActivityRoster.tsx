import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiFailure, api } from '../api';
import { Icon } from '../components/Icon';
import { Menu } from '../components/Menu';
import { useToast } from '../components/Toast';
import { BackLink, Loading, LoadError, Notice, Skeleton, SkeletonHeading, SkeletonList, SkeletonTiles } from '../components/ui';
import { deleteContext } from '../confirmDelete';
import { useTitle } from '../useTitle';
import { useApi } from '../useApi';
import { useEvent } from './EventLayout';
import { matchesSearch, searchRank } from '../../shared/search';
import { dayInZone, dayLabel, timeInZone, timeRange } from '../../shared/time';

interface RosterPerson {
  id: string;
  name: string;
  groupName: string;
  section: string;
  booked: boolean;
  present: boolean;
  visits: number;
  lastAt: string | null;
  noPhotos?: boolean;
}

interface Attendance {
  activity: {
    id: string;
    name: string;
    location: string;
    instructions: string;
    startsAt: string | null;
    endsAt: string | null;
    capacity: number | null;
    trackSignOut: boolean;
    signupOpen: boolean;
    bookingRequired: boolean;
    status: 'active' | 'cancelled';
  };
  presentNow: number;
  canBook: boolean;
  canCheckIn: boolean;
  people: RosterPerson[];
  everyone: { id: string; name: string; groupName: string }[];
}

/** One id per browser tab, so check-ins made here are grouped as one device in reports. */
const DEVICE_ID = `web-roster-${crypto.randomUUID().slice(0, 12)}`;

/**
 * An activity's roster for its leaders (and event managers): who's booked,
 * who's here, check people in and out with a tap, and add walk-ins.
 */
export function ActivityRoster() {
  const { event, can } = useEvent();
  const { activityId } = useParams() as { activityId: string };
  const navigate = useNavigate();
  const toast = useToast();
  const path = `/events/${event.id}/activities/${activityId}`;
  const { data, error, loading, reload } = useApi<Attendance>(`${path}/attendance`);
  useTitle(data?.activity.name ?? 'Activity');
  const manage = can('activities.manage') && (event.status === 'draft' || event.status === 'open');
  const [show, setShow] = useState<'booked' | 'here' | 'all'>('booked');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState('');
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'stop'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const tz = event.timezone;

  useEffect(() => {
    const t = setInterval(() => void reload(), 20_000);
    return () => clearInterval(t);
  }, [reload]);

  // Start on whichever list has people in it.
  const hasBookings = (data?.people ?? []).some((p) => p.booked);
  useEffect(() => {
    if (data && !hasBookings) setShow('all');
  }, [data, hasBookings]);

  async function checkIn(p: { id: string; name: string }, direction: 'in' | 'out') {
    setBusy(p.id);
    setMessage(null);
    try {
      const res = await api<{ results: { outcome: string; message: string; warning: string | null }[] }>(`/events/${event.id}/scans`, {
        body: {
          deviceId: DEVICE_ID,
          scans: [{ id: crypto.randomUUID(), contextType: 'activity', contextId: activityId, direction, deviceTime: new Date().toISOString(), method: 'manual', registrationId: p.id }],
        },
      });
      const r = res.results[0]!;
      setMessage({
        tone: r.outcome === 'accepted' ? (r.warning ? 'warn' : 'ok') : r.outcome === 'duplicate' ? 'warn' : 'stop',
        text: `${p.name}: ${r.message}${r.warning ? ` ${r.warning}` : ''}`,
      });
      await reload();
    } catch (err) {
      setMessage({ tone: 'stop', text: err instanceof ApiFailure ? err.message : 'No connection. Use the scanner, which works offline.' });
    } finally {
      setBusy(null);
    }
  }

  async function booking(p: { id: string; name: string }, add: boolean) {
    setBusy(p.id);
    setMessage(null);
    try {
      if (add) await api(`${path}/bookings`, { body: { registrationId: p.id } });
      else await api(`${path}/bookings/${p.id}`, { method: 'DELETE' });
      toast(
        add ? `Booked ${p.name}.` : `Removed ${p.name}'s booking.`,
        add
          ? {}
          : {
              undo: async () => {
                await api(`${path}/bookings`, { body: { registrationId: p.id } });
                await reload();
              },
            },
      );
      await reload();
    } catch (err) {
      setMessage({ tone: 'stop', text: err instanceof ApiFailure ? err.message : 'Something went wrong.' });
    } finally {
      setBusy(null);
    }
  }

  async function changeStatus(status: 'active' | 'cancelled') {
    try {
      await api(path, { method: 'PATCH', body: { status } });
      await reload();
      toast(status === 'cancelled' ? 'Activity cancelled.' : 'Activity restored.', status === 'cancelled' ? { undo: () => changeStatus('active') } : {});
    } catch (err) {
      setMessage({ tone: 'stop', text: err instanceof ApiFailure ? err.message : 'Something went wrong.' });
    }
  }

  async function remove() {
    try {
      if (await deleteContext(event.id, 'activities', activityId, data!.activity.name)) {
        navigate('..', { relative: 'path', replace: true });
        toast(`Deleted ${data!.activity.name}.`);
      }
    } catch (err) {
      setMessage({ tone: 'stop', text: err instanceof ApiFailure ? err.message : 'Something went wrong.' });
    }
  }

  const involved = useMemo(() => new Set((data?.people ?? []).map((p) => p.id)), [data]);
  if (loading && !data)
    return (
      <Loading label="Loading activity">
        <Skeleton width="5.5rem" height="1rem" className="skeleton-gap" />
        <SkeletonHeading width="12rem" />
        <SkeletonTiles />
        <Skeleton width="100%" height="72px" radius="var(--radius)" className="skeleton-gap" />
        <SkeletonList rows={5} aside="button" />
      </Loading>
    );
  if (error)
    return (
      <>
        <BackLink to=".." label="Activities" />
        <LoadError error={error} onRetry={reload} message={error.status === 404 || error.status === 403 ? "This activity has been deleted, or you don't run it." : undefined} />
      </>
    );
  if (!data) return null;
  const a = data.activity;
  const booked = data.people.filter((p) => p.booked);
  const notYet = booked.filter((p) => p.visits === 0);
  const list = data.people
    .filter((p) => (show === 'booked' ? p.booked : show === 'here' ? p.present : true))
    .filter((p) => matchesSearch(q, p.name, p.groupName))
    .sort((x, y) => Number(y.present) - Number(x.present) || x.name.localeCompare(y.name));
  const walkIns = adding.trim()
    ? data.everyone
        .filter((p) => !involved.has(p.id) && matchesSearch(adding, p.name, p.groupName))
        .sort((x, y) => searchRank(adding, x.name) - searchRank(adding, y.name))
        .slice(0, 8)
    : [];

  return (
    <div className="activity-roster">
      <BackLink to=".." label="Activities" />
      <div className="title-row">
        <h2 className="person-name">{a.name}</h2>
        {manage && (
          <Menu
            label={`More actions for ${a.name}`}
            items={[
              { label: 'Edit activity', to: 'edit' },
              { label: 'Add another session', to: `../new?from=${a.id}` },
              a.status === 'active'
                ? {
                    label: 'Cancel activity',
                    onSelect: () => {
                      if (!window.confirm(`Cancel ${a.name}? It stops showing on scanners and the sign-up screen. Scans and bookings are kept.`)) return;
                      void changeStatus('cancelled');
                    },
                  }
                : { label: 'Restore activity', onSelect: () => void changeStatus('active') },
              { label: 'Delete activity…', danger: true, onSelect: () => void remove() },
            ]}
          />
        )}
      </div>
      {a.status === 'cancelled' && <Notice tone="warn">This activity is cancelled. It doesn't show on scanners or the sign-up screen.</Notice>}
      <p className="lede flush">
        {[a.startsAt ? `${dayLabel(dayInZone(a.startsAt, tz), 'long')}, ${timeRange(a.startsAt, a.endsAt, tz)}` : 'Runs all camp', a.location || null]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {a.instructions && <Notice title="Instructions">{a.instructions}</Notice>}

      <div className="tiles section-gap-sm">
        <div className="tile tile-on">
          <strong>
            {a.trackSignOut ? data.presentNow : data.people.filter((p) => p.visits > 0).length}
            {a.capacity ? <small> / {a.capacity}</small> : null}
          </strong>
          <span>{a.trackSignOut ? 'Here now' : 'Checked in'}</span>
        </div>
        <div className="tile">
          <strong>{booked.length}</strong>
          <span>Booked</span>
        </div>
        <div className="tile tile-off">
          <strong>{notYet.length}</strong>
          <span>Booked, not here</span>
        </div>
      </div>

      {data.canCheckIn && (
        <Link to={`/events/${event.id}/scan/activity/${a.id}`} className="scan-cta">
          <Icon name="scan" size={26} />
          <span>
            <strong>Open scanner</strong>
            <span>Scan lanyards as people arrive{a.trackSignOut ? ' and leave' : ''}</span>
          </span>
          <Icon name="chevron" />
        </Link>
      )}

      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <div className="segmented segmented-3" role="group" aria-label="Show">
        {(
          [
            ['booked', `Booked ${booked.length}`],
            ['here', `${a.trackSignOut ? 'Here' : 'Checked in'} ${a.trackSignOut ? data.presentNow : data.people.filter((p) => p.visits > 0).length}`],
            ['all', `Everyone ${data.people.length}`],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)}>
            {label}
          </button>
        ))}
      </div>
      <input className="input section-gap-sm" type="search" aria-label="Search this list" placeholder="Search names, even one letter" value={q} onChange={(e) => setQ(e.target.value)} />

      <ul className="list section-gap-sm">
        {list.map((p) => (
          <li key={p.id} className="list-row roster-person">
            <span className="list-main">
              <strong>
                {p.name}
                {p.noPhotos && <span className="tag tag-stop roster-flag">No photos</span>}
              </strong>
              <span>
                {p.groupName}
                {p.groupName && ', '}
                {p.section}
              </span>
            </span>
            <span className={`place ${p.present ? 'place-on' : p.visits > 0 ? 'place-off' : 'place-never'}`}>
              {p.present
                ? `Here since ${p.lastAt ? timeInZone(p.lastAt, tz) : ''}`
                : p.visits > 0
                  ? a.trackSignOut
                    ? `Left ${p.lastAt ? timeInZone(p.lastAt, tz) : ''}`
                    : `Checked in ${p.lastAt ? timeInZone(p.lastAt, tz) : ''}`
                  : p.booked
                    ? 'Not here yet'
                    : 'Not booked'}
            </span>
            <span className="row-actions">
              {data.canCheckIn &&
                (p.present && a.trackSignOut ? (
                  <button className="btn btn-secondary btn-small" disabled={busy === p.id} onClick={() => void checkIn(p, 'out')}>
                    Check out<span className="visually-hidden"> {p.name}</span>
                  </button>
                ) : (
                  !(p.visits > 0 && !a.trackSignOut) && (
                    <button className="btn btn-small" disabled={busy === p.id} onClick={() => void checkIn(p, 'in')}>
                      Check in<span className="visually-hidden"> {p.name}</span>
                    </button>
                  )
                ))}
              {data.canBook && p.booked && !p.present && (
                <button className="btn-link text-stop" disabled={busy === p.id} onClick={() => void booking(p, false)}>
                  Remove booking<span className="visually-hidden"> for {p.name}</span>
                </button>
              )}
              {data.canBook && !p.booked && (
                <button className="btn-link" disabled={busy === p.id} onClick={() => void booking(p, true)}>
                  Add booking<span className="visually-hidden"> for {p.name}</span>
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {list.length === 0 && (
        <p className="field-hint">
          {show === 'booked' ? 'No one has booked yet.' : show === 'here' ? 'No one is checked in right now.' : 'No one yet.'}
        </p>
      )}

      {(data.canCheckIn || data.canBook) && (
        <section className="list-section section-gap">
          <h3 className="list-heading">Add someone</h3>
          <input className="input" type="search" aria-label="Find someone on the camp roster" placeholder="Anyone on camp: type a name" value={adding} onChange={(e) => setAdding(e.target.value)} />
          {walkIns.length > 0 && (
            <ul className="list section-gap-sm">
              {walkIns.map((p) => (
                <li key={p.id} className="list-row roster-person">
                  <span className="list-main">
                    <strong>{p.name}</strong>
                    <span>{p.groupName}</span>
                  </span>
                  <span className="row-actions">
                    {data.canCheckIn && (
                      <button className="btn btn-small" disabled={busy === p.id} onClick={() => void checkIn(p, 'in').then(() => setAdding(''))}>
                        Check in<span className="visually-hidden"> {p.name}</span>
                      </button>
                    )}
                    {data.canBook && (
                      <button className="btn-link" disabled={busy === p.id} onClick={() => void booking(p, true).then(() => setAdding(''))}>
                        Add booking<span className="visually-hidden"> for {p.name}</span>
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
