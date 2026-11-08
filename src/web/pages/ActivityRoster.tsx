import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ApiFailure, api } from '../api';
import { deleteContext } from '../confirmDelete';
import { recordByHand } from '../scan/manual';
import { useApi } from '../useApi';
import { matchesSearch, searchRank } from '../../shared/search';
import { dayInZone, dayLabel, timeInZone, timeRange } from '../../shared/time';
import {
  Badge,
  Button,
  ButtonLink,
  CountTile,
  EmptyState,
  Icon,
  LoadError,
  Loading,
  Menu,
  Notice,
  PageHeader,
  SearchField,
  Segmented,
  Sheet,
  SkeletonHeader,
  SkeletonRows,
  useConfirm,
  useToast,
} from '../ui';
import type { MenuItem } from '../ui';
import { useEvent } from './EventLayout';

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
    capacityPolicy: 'warn' | 'block';
    trackSignOut: boolean;
    signupOpen: boolean;
    bookingRequired: boolean;
    teamEvent?: boolean;
    status: 'active' | 'cancelled';
  };
  presentNow: number;
  canBook: boolean;
  canCheckIn: boolean;
  people: RosterPerson[];
  everyone: { id: string; name: string; groupName: string }[];
}

type Show = 'tocome' | 'here' | 'all';

/**
 * One activity, for its leaders and event managers: who's booked, who's
 * here, check people in and out with a tap, and add walk-ins.
 */
export function ActivityRoster() {
  const { event, can, base } = useEvent();
  const { activityId } = useParams() as { activityId: string };
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const path = `/events/${event.id}/activities/${activityId}`;
  const { data, error, loading, reload } = useApi<Attendance>(`${path}/attendance`);
  const manage = can('activities.manage') && (event.status === 'draft' || event.status === 'open');
  const [show, setShow] = useState<Show>('tocome');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [find, setFind] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const tz = event.timezone;
  const list = `${base}/activities`;

  useEffect(() => {
    const t = setInterval(() => void reload(), 20_000);
    return () => clearInterval(t);
  }, [reload]);

  // Nobody booked: start on everyone involved, so the list isn't empty.
  const hasBookings = (data?.people ?? []).some((p) => p.booked);
  useEffect(() => {
    if (data && !hasBookings) setShow('all');
  }, [data, hasBookings]);

  const fail = (err: unknown, offline = 'No connection. Check your signal and try again.') => toast(err instanceof ApiFailure ? err.message : offline, { tone: 'error' });

  async function checkIn(p: { id: string; name: string }, direction: 'in' | 'out') {
    setBusy(p.id);
    try {
      const r = await recordByHand(event.id, { contextType: 'activity', contextId: activityId, direction, registrationId: p.id });
      if (r.outcome === 'accepted')
        toast(`${p.name} ${direction === 'in' ? 'checked in' : 'signed out'}${r.warning ? `. ${r.warning}` : ''}`, direction === 'in' ? { undo: () => moveBack(p, true) } : {});
      else toast(`${p.name}: ${r.message}`, { tone: 'error' });
      await reload();
    } catch (err) {
      fail(err, 'No connection. Use the scanner, which works offline.');
    } finally {
      setBusy(null);
    }
  }

  /** Undo their check-ins here: back to "To come" (or off the list, for a walk-in). */
  async function moveBack(p: { id: string; name: string }, quiet = false) {
    try {
      await api(`${path}/attendance/${p.id}/reset`, { method: 'POST' });
      if (!quiet) toast(`${p.name} moved back to To come`);
      await reload();
    } catch (err) {
      fail(err);
      if (quiet) throw err;
    }
  }

  async function booking(p: { id: string; name: string }, add: boolean) {
    setBusy(p.id);
    try {
      if (add) await api(`${path}/bookings`, { body: { registrationId: p.id } });
      else await api(`${path}/bookings/${p.id}`, { method: 'DELETE' });
      await reload();
      toast(
        add ? `${p.name} booked` : `${p.name}'s booking removed`,
        add
          ? {}
          : {
              undo: async () => {
                await api(`${path}/bookings`, { body: { registrationId: p.id } });
                await reload();
              },
            },
      );
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function changeStatus(status: 'active' | 'cancelled') {
    try {
      await api(path, { method: 'PATCH', body: { status } });
      await reload();
      toast(status === 'cancelled' ? 'Activity cancelled' : 'Activity restored', status === 'cancelled' ? { undo: () => changeStatus('active') } : {});
    } catch (err) {
      fail(err);
    }
  }

  const involved = useMemo(() => new Set((data?.people ?? []).filter((p) => p.booked || p.visits > 0).map((p) => p.id)), [data]);

  if (loading && !data)
    return (
      <Loading what="activity">
        <SkeletonHeader />
        <SkeletonRows rows={6} action />
      </Loading>
    );
  if (error)
    return (
      <>
        <PageHeader title="Activity" back={{ to: list, label: 'Activities' }} />
        <LoadError
          error={error}
          onRetry={reload}
          what="this activity"
          message={error.status === 404 || error.status === 403 ? "This activity has been deleted, or you don't run it." : undefined}
        />
      </>
    );
  if (!data) return null;
  const a = data.activity;
  const hereCount = a.trackSignOut ? data.presentNow : data.people.filter((p) => p.visits > 0).length;
  const booked = data.people.filter((p) => p.booked);
  const toCome = booked.filter((p) => p.visits === 0);
  const shown = data.people
    .filter((p) => (show === 'tocome' ? p.booked && p.visits === 0 : show === 'here' ? (a.trackSignOut ? p.present : p.visits > 0) : p.booked || p.visits > 0))
    .filter((p) => matchesSearch(q, p.name, p.groupName))
    .sort((x, y) => Number(x.visits > 0) - Number(y.visits > 0) || x.name.localeCompare(y.name));
  const walkIns = find.trim()
    ? data.everyone
        .filter((p) => !involved.has(p.id) && matchesSearch(find, p.name, p.groupName))
        .sort((x, y) => searchRank(find, x.name) - searchRank(find, y.name))
        .slice(0, 12)
    : [];
  const when = a.startsAt ? `${dayLabel(dayInZone(a.startsAt, tz))}, ${timeRange(a.startsAt, a.endsAt, tz)}` : 'Runs all camp';
  const canScan = data.canCheckIn && event.status === 'open' && a.status === 'active';

  const teams = a.teamEvent ? `${base}/teams/${a.id}` : null;
  const menu: MenuItem[] = teams
    ? [{ label: 'Teams', to: teams }, ...(manage ? [{ label: 'Edit settings', to: teams }] : []), { label: 'Print this list', onSelect: () => window.print() }]
    : manage
    ? [
        { label: 'Edit activity', to: `${list}/${a.id}/edit` },
        { label: 'Add another session', to: `${list}/new?from=${a.id}` },
        { label: 'Print this list', onSelect: () => window.print() },
        a.status === 'active'
          ? {
              label: 'Cancel activity',
              onSelect: async () => {
                const ok = await confirm({
                  title: `Cancel ${a.name}?`,
                  body: <p>It stops showing on scanners and the sign-up kiosk. Scans and bookings are kept, and you can restore it.</p>,
                  confirm: 'Cancel activity',
                });
                if (ok) await changeStatus('cancelled');
              },
            }
          : { label: 'Restore activity', onSelect: () => void changeStatus('active') },
        {
          label: 'Delete activity…',
          danger: true,
          onSelect: async () => {
            try {
              if (await deleteContext(confirm, event.id, 'activities', a.id, a.name)) {
                toast(`Deleted ${a.name}`);
                navigate(list, { replace: true });
              }
            } catch (err) {
              fail(err);
            }
          },
        },
      ]
    : [{ label: 'Print this list', onSelect: () => window.print() }];

  const status = (p: RosterPerson) =>
    p.present ? (
      <Badge tone="success">Here since {p.lastAt ? timeInZone(p.lastAt, tz) : ''}</Badge>
    ) : p.visits > 0 ? (
      <Badge>
        {a.trackSignOut ? 'Left' : 'Signed in'} {p.lastAt ? timeInZone(p.lastAt, tz) : ''}
      </Badge>
    ) : p.booked ? (
      <Badge tone="warning">To come</Badge>
    ) : null;

  return (
    <>
      <PageHeader
        title={a.name}
        back={teams && manage ? { to: `${base}/teams`, label: 'Teams' } : { to: list, label: 'Activities' }}
        summary={
          <>
            <span className="sep">{when}</span>
            {a.location && <span className="sep">{a.location}</span>}
            {a.status === 'cancelled' && <Badge tone="neutral">Cancelled</Badge>}
          </>
        }
        primary={
          canScan && (
            <ButtonLink to={`/events/${event.id}/scan/activity/${a.id}`} kind="primary">
              <Icon name="scan" />
              Scan
            </ButtonLink>
          )
        }
        menu={menu}
        menuLabel={`More actions for ${a.name}`}
      />
      <div className="sections">
        {a.status === 'cancelled' && (
          <Notice tone="warning">
            <p>This activity is cancelled. It doesn't show on scanners or the sign-up kiosk.</p>
          </Notice>
        )}
        {a.instructions && (
          <Notice title="Instructions for leaders">
            <p className="pre-line">{a.instructions}</p>
          </Notice>
        )}

        <div className="tiles">
          <CountTile value={a.capacity ? `${booked.length}/${a.capacity}` : booked.length} label={a.capacity ? 'Places booked' : 'Booked'} />
          <CountTile value={hereCount} label={a.trackSignOut ? 'Here now' : 'Checked in'} tone="success" />
          <CountTile value={toCome.length} label="To come" tone="warning" />
        </div>
        {a.capacity !== null && (
          <p className="meta">
            {booked.length >= a.capacity ? (
              <Badge tone="warning">Full</Badge>
            ) : (
              <Badge tone="success">{`${a.capacity - booked.length} ${a.capacity - booked.length === 1 ? 'place' : 'places'} left`}</Badge>
            )}{' '}
            {a.capacity} places. When it's full, people can't book themselves.
            {a.trackSignOut &&
              (a.capacityPolicy === 'block'
                ? ` Check-ins stop at ${a.capacity} here at once.`
                : ` More than ${a.capacity} here at once can still be checked in, with a warning.`)}
          </p>
        )}

        <div className="toolbar">
          <Segmented
            label="Show"
            value={show}
            onChange={setShow}
            options={[
              { value: 'tocome', label: `To come (${toCome.length})` },
              { value: 'here', label: `Here (${hereCount})` },
              { value: 'all', label: 'All' },
            ]}
          />
          {(data.canCheckIn || data.canBook) && (
            <Button onClick={() => setAdding(true)}>
              <Icon name="plus" />
              Add someone
            </Button>
          )}
        </div>
        {data.people.length > 12 && <SearchField id="activity-q" label="Search this list" value={q} onChange={setQ} />}

        {shown.length === 0 ? (
          <EmptyState title={q ? `No one matches "${q}"` : show === 'tocome' ? 'Everyone booked is here' : show === 'here' ? 'No one is here right now' : 'No one yet'}>
            {!q && show === 'all' && (data.canCheckIn || data.canBook) ? 'Use Add someone to book or sign in a walk-in.' : undefined}
          </EmptyState>
        ) : (
          <ul className="list activity-list">
            {shown.map((p) => {
              const out = p.present && a.trackSignOut;
              const done = p.visits > 0 && !a.trackSignOut;
              return (
                <li key={p.id} className="row">
                  <span className="row-main">
                    <span className="row-title">{p.name}</span>
                    <span className="row-meta">{[p.section, p.groupName].filter(Boolean).join(' · ')}</span>
                    <span className="activity-badges">
                      {status(p)}
                      {p.noPhotos && <Badge tone="error">No photos</Badge>}
                    </span>
                  </span>
                  <span className="row-side">
                    {data.canCheckIn && !done && (
                      <Button small kind={out ? 'secondary' : 'primary'} busy={busy === p.id} busyLabel="Saving…" onClick={() => void checkIn(p, out ? 'out' : 'in')}>
                        {out ? 'Sign out' : 'Check in'}
                        <span className="visually-hidden"> {p.name}</span>
                      </Button>
                    )}
                    {((data.canCheckIn && p.visits > 0 && event.status === 'open') || (data.canBook && p.booked && !p.present)) && (
                      <Menu
                        label={`More for ${p.name}`}
                        items={[
                          data.canCheckIn && p.visits > 0 && event.status === 'open' && { label: p.booked ? 'Move back to To come' : 'Undo check-in', onSelect: () => void moveBack(p) },
                          data.canBook && p.booked && !p.present && { label: 'Remove booking', danger: true, onSelect: () => void booking(p, false) },
                        ]}
                      />
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Sheet
        open={adding}
        title="Add someone"
        onClose={() => {
          setAdding(false);
          setFind('');
        }}
      >
        {/* The sheet opens to find someone, so the search box is where focus belongs. */}
        {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
        <SearchField id="walkin-q" label="Anyone on camp: type a name" value={find} onChange={setFind} autoFocus />
        {find.trim() === '' ? (
          <p className="meta">{data.canCheckIn ? 'Sign in a walk-in, or book someone for this session.' : 'Book someone for this session.'}</p>
        ) : walkIns.length === 0 ? (
          <p className="meta">No one else on camp matches "{find}".</p>
        ) : (
          <ul className="list">
            {walkIns.map((p) => (
              <li key={p.id} className="row">
                <span className="row-main">
                  <span className="row-title">{p.name}</span>
                  <span className="row-meta">{p.groupName}</span>
                </span>
                <span className="row-side">
                  {data.canBook && (
                    <Button small busy={busy === p.id} onClick={() => void booking(p, true)}>
                      Book<span className="visually-hidden"> {p.name}</span>
                    </Button>
                  )}
                  {canScan && (
                    <Button small kind="primary" busy={busy === p.id} onClick={() => void checkIn(p, 'in')}>
                      Check in<span className="visually-hidden"> {p.name}</span>
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </>
  );
}
