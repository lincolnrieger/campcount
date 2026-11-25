import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ApiFailure, api } from '../api';
import { deleteContext } from '../confirmDelete';
import { recordByHand } from '../scan/manual';
import type { Activity } from '../model';
import { useApi } from '../useApi';
import { matchesSearch, searchRank } from '../../shared/search';
import { dayInZone, dayLabel, timeInZone, timeRange } from '../../shared/time';
import {
  Badge,
  Banner,
  Button,
  ButtonLink,
  EmptyState,
  Icon,
  LoadError,
  Loading,
  Menu,
  Notice,
  PageHeader,
  SearchField,
  Sheet,
  SkeletonHeader,
  SkeletonRows,
  StatStrip,
  Toolbar,
  plural,
  useConfirm,
  useToast,
} from '../ui';
import type { MenuItem } from '../ui';
import { useEvent } from './EventLayout';
import { usePolling } from '../usePolling';

interface RosterPerson {
  id: string;
  name: string;
  level: string;
  booked: boolean;
  present: boolean;
  visits: number;
  lastAt: string | null;
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
  everyone: { id: string; name: string }[];
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
  // Opened from the scanner's "Add someone to come": start with the add sheet open.
  const [adding, setAdding] = useState(() => new URLSearchParams(window.location.search).get('add') === '1');
  const [find, setFind] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [moving, setMoving] = useState<{ id: string; name: string } | null>(null);
  const tz = event.timezone;
  // Moving needs booking rights on the other activity too: event managers, and scanners (who book on any activity).
  const canMove = can('activities.manage') || (can('activity.bookings') && can('site.scan'));
  const list = `${base}/activities`;

  usePolling(reload, 20_000);

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
        add ? `${p.name} added to To come` : `${p.name}'s booking removed`,
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
    .filter((p) => matchesSearch(q, p.name))
    .sort((x, y) => Number(x.visits > 0) - Number(y.visits > 0) || x.name.localeCompare(y.name));
  const walkIns = find.trim()
    ? data.everyone
        .filter((p) => !involved.has(p.id) && matchesSearch(find, p.name))
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

  const placesLeft = a.capacity !== null ? Math.max(0, a.capacity - booked.length) : null;
  const capacityHelp =
    a.capacity !== null
      ? `${a.capacity} places. When it's full, people can't book themselves.${
          a.trackSignOut
            ? a.capacityPolicy === 'block'
              ? ` Check-ins stop at ${a.capacity} here at once.`
              : ` More than ${a.capacity} here at once can still be checked in, with a warning.`
            : ''
        }`
      : undefined;
  const canAdd = data.canCheckIn || data.canBook;

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
        help={capacityHelp}
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
      <div className="sections pg-sections">
        {(a.status === 'cancelled' || a.instructions) && (
          <div className="banners">
            {a.status === 'cancelled' && (
              <Banner
                tone="warning"
                action={
                  manage &&
                  !teams && (
                    <Button small onAction={() => changeStatus('active')} busyLabel="Restoring…">
                      Restore
                    </Button>
                  )
                }
              >
                Cancelled. <span className="meta">Not on scanners or the sign-up kiosk.</span>
              </Banner>
            )}
            {a.instructions && (
              <details className="pg-instructions" open={a.instructions.length <= 240}>
                <summary>
                  <Icon name="clipboard" size={18} />
                  Instructions for leaders
                  <Icon name="down" size={16} />
                </summary>
                <p className="pre-line">{a.instructions}</p>
              </details>
            )}
          </div>
        )}

        <StatStrip
          items={[
            { label: 'To come', value: toCome.length, tone: toCome.length ? 'warning' : undefined, pressed: show === 'tocome', onPress: () => setShow('tocome') },
            { label: a.trackSignOut ? 'Here now' : 'Checked in', value: hereCount, tone: 'success', pressed: show === 'here', onPress: () => setShow('here') },
            { label: 'Everyone', value: involved.size, pressed: show === 'all', onPress: () => setShow('all'), hint: 'Booked, or checked in at some point' },
            a.capacity !== null
              ? {
                  label: placesLeft === 0 ? 'Booked, full' : `Booked, ${plural(placesLeft!, 'place')} left`,
                  value: `${booked.length}/${a.capacity}`,
                  tone: placesLeft === 0 ? 'warning' : undefined,
                  hint: capacityHelp,
                }
              : { label: 'Booked', value: booked.length },
          ]}
        />

        <Toolbar sticky label="Find people">
          {data.people.length > 0 && <SearchField id="activity-q" label="Search this list" value={q} onChange={setQ} slash />}
          {canAdd && (
            <div className="toolbar-end">
              <Button onClick={() => setAdding(true)}>
                <Icon name="plus" />
                Add someone
              </Button>
            </div>
          )}
        </Toolbar>

        {shown.length === 0 ? (
          <EmptyState
            title={q ? `No one matches "${q}"` : show === 'tocome' ? 'Everyone booked is here' : show === 'here' ? 'No one is here right now' : 'No one yet'}
            actions={q ? <Button onClick={() => setQ('')}>Clear search</Button> : undefined}
          />
        ) : (
          <ul className="pg-people activity-list" aria-label={show === 'tocome' ? 'To come' : show === 'here' ? 'Here' : 'Everyone'}>
            {shown.map((p) => {
              const out = p.present && a.trackSignOut;
              const done = p.visits > 0 && !a.trackSignOut;
              return (
                <li key={p.id} className="row pg-person">
                  <span className="row-main">
                    <span className="row-title">{p.name}</span>
                    <span className="row-meta">{p.level}</span>
                    <span className="activity-badges">{status(p)}</span>
                  </span>
                  <span className="row-side">
                    {data.canCheckIn && !done && (
                      <Button small kind={out ? 'secondary' : 'primary'} busy={busy === p.id} busyLabel="Saving…" onClick={() => void checkIn(p, out ? 'out' : 'in')}>
                        {out ? 'Sign out' : 'Check in'}
                        <span className="visually-hidden"> {p.name}</span>
                      </Button>
                    )}
                    {((data.canCheckIn && p.visits > 0 && event.status === 'open') || (data.canBook && p.booked && !p.present) || (canMove && p.booked)) && (
                      <Menu
                        label={`More for ${p.name}`}
                        items={[
                          data.canCheckIn &&
                            p.visits > 0 &&
                            event.status === 'open' && { label: p.booked ? 'Move back to To come' : 'Undo check-in', onSelect: () => void moveBack(p) },
                          canMove && p.booked && event.status !== 'completed' && { label: 'Move to another activity…', onSelect: () => setMoving(p) },
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

      {moving && (
        <MoveSheet
          eventId={event.id}
          tz={tz}
          from={{ id: a.id, name: a.name }}
          person={moving}
          onClose={() => setMoving(null)}
          onMoved={async (to) => {
            setMoving(null);
            toast(`${moving.name} moved to ${to}`);
            await reload();
          }}
        />
      )}

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
          <p className="meta">{data.canBook ? 'Book them to come, or check in a walk-in.' : 'Check in a walk-in.'}</p>
        ) : walkIns.length === 0 ? (
          <p className="meta">No one else on camp matches "{find}".</p>
        ) : (
          <ul className="list">
            {walkIns.map((p) => (
              <li key={p.id} className="row">
                <span className="row-main">
                  <span className="row-title">{p.name}</span>
                </span>
                <span className="row-side">
                  {data.canBook && (
                    <Button small busy={busy === p.id} onClick={() => void booking(p, true)}>
                      Add to come<span className="visually-hidden">: {p.name}</span>
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

/** Pick where to move someone's booking: other sessions of the same activity first, then everything else. */
function MoveSheet({
  eventId,
  tz,
  from,
  person,
  onClose,
  onMoved,
}: {
  eventId: string;
  tz: string;
  from: { id: string; name: string };
  person: { id: string; name: string };
  onClose: () => void;
  onMoved: (to: string) => Promise<void>;
}) {
  const { data, error } = useApi<{ activities: Activity[] }>(`/events/${eventId}/activities`);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const options = (data?.activities ?? []).filter((x) => x.id !== from.id && x.status === 'active' && x.kind !== 'program' && !x.teamEvent && matchesSearch(q, x.name, x.location));
  const same = options.filter((x) => x.name.toLowerCase() === from.name.toLowerCase());
  const others = options.filter((x) => x.name.toLowerCase() !== from.name.toLowerCase());
  const when = (x: Activity) => (x.startsAt ? `${dayLabel(dayInZone(x.startsAt, tz))}, ${timeRange(x.startsAt, x.endsAt, tz)}` : 'Any time');

  async function move(to: Activity) {
    setBusy(to.id);
    setFailure(null);
    try {
      await api(`/events/${eventId}/activities/${from.id}/bookings/${person.id}/move`, { body: { to: to.id } });
      await onMoved(to.name);
    } catch (err) {
      setFailure(err instanceof ApiFailure ? err.message : 'No connection. Try again.');
      setBusy(null);
    }
  }

  const row = (x: Activity) => (
    <li key={x.id} className="row">
      <span className="row-main">
        <span className="row-title">{x.name}</span>
        <span className="row-meta">{[when(x), x.location, x.capacity !== null ? `${x.booked} of ${x.capacity} booked` : null].filter(Boolean).join(' · ')}</span>
      </span>
      <span className="row-side">
        <Button small kind="primary" busy={busy === x.id} busyLabel="Moving…" disabled={busy !== null} onClick={() => void move(x)}>
          Move here
          <span className="visually-hidden">
            {' '}
            to {x.name}, {when(x)}
          </span>
        </Button>
      </span>
    </li>
  );

  return (
    <Sheet open title={`Move ${person.name}`} onClose={onClose}>
      <p className="meta">Moves their booking from {from.name}. The place limit doesn't apply.</p>
      {failure && (
        <Notice tone="error">
          <p>{failure}</p>
        </Notice>
      )}
      <SearchField id="move-q" label="Find an activity" value={q} onChange={setQ} />
      {error ? (
        <p className="meta">Activities couldn't be loaded. Check your signal and try again.</p>
      ) : !data ? (
        <SkeletonRows rows={4} action />
      ) : options.length === 0 ? (
        <p className="meta">No other activities{q ? ` match "${q}"` : ''}.</p>
      ) : (
        <>
          {same.length > 0 && (
            <div className="list">
              <h3 className="list-group-heading">Other {from.name} sessions</h3>
              <ul>{same.map(row)}</ul>
            </div>
          )}
          {others.length > 0 && (
            <div className="list">
              <h3 className="list-group-heading">{same.length ? 'Other activities' : 'Activities'}</h3>
              <ul>{others.map(row)}</ul>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
