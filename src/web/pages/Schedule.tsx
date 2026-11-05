import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router';
import { clockInZone, dayInZone, dayLabel, eventDays, todayInZone, zonedIso } from '../../shared/time';
import { ApiFailure, api } from '../api';
import { deleteContext } from '../confirmDelete';
import type { Activity, Meal } from '../model';
import { useApi } from '../useApi';
import {
  Badge,
  Button,
  ButtonLink,
  EmptyState,
  Field,
  FilterTabs,
  Icon,
  LoadError,
  Loading,
  PageHeader,
  Segmented,
  Sheet,
  SkeletonRows,
  plural,
  useConfirm,
  useToast,
  useWide,
} from '../ui';
import { useEvent } from './EventLayout';

/** Pixels per minute, and the grid's snap. */
const PX = 1.2;
const SNAP = 15;
const DEFAULT_LENGTH = 60;

interface Item {
  key: string;
  id: string;
  kind: 'activity' | 'meal';
  name: string;
  location: string;
  cancelled: boolean;
  /** Event-local day, or null for "no set time". */
  day: string | null;
  start: number;
  end: number;
  openEnded: boolean;
  /** A programme item (Welcome, Movies…): an activity row that's never booked or scanned. */
  program: boolean;
  activity?: Activity;
  meal?: Meal;
}

const toMin = (hhmm: string) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);
const toHHMM = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const label = (min: number) => {
  const h = Math.floor(min / 60) % 24;
  return `${h % 12 || 12}:${String(min % 60).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};
const hourLabel = (h: number) => `${h % 12 || 12} ${h % 24 < 12 ? 'am' : 'pm'}`;

/** Side-by-side columns for sessions that overlap on the same day. */
function layout(items: Item[]): Map<string, { lane: number; lanes: number }> {
  const out = new Map<string, { lane: number; lanes: number }>();
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster: Item[] = [];
  let clusterEnd = -1;
  const laneEnds: number[] = [];
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((i) => out.get(i.key)!.lane + 1));
    for (const i of cluster) out.set(i.key, { lane: out.get(i.key)!.lane, lanes });
    cluster = [];
    laneEnds.length = 0;
  };
  for (const it of sorted) {
    if (it.start >= clusterEnd && cluster.length) flush();
    let lane = laneEnds.findIndex((end) => end <= it.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = it.end;
    out.set(it.key, { lane, lanes: 1 });
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) flush();
  return out;
}

type Drag = { key: string; mode: 'move' | 'resize'; day: string; start: number; end: number; moved: boolean };

/**
 * The whole camp at a glance: every day side by side, every activity and
 * meal where it happens. Drag to move or change length, click for details,
 * click an empty spot to add. Every change can also be made from the
 * details panel, so nothing needs a mouse.
 */
export function Schedule() {
  const { event, can, base } = useEvent();
  const toast = useToast();
  const confirm = useConfirm();
  const wide = useWide();
  const tz = event.timezone;
  const days = eventDays(event.startsOn, event.endsOn);
  const manageActivities = event.features.activities && can('activities.manage');
  const manageMeals = event.features.meals && can('meals.manage');
  const editable = event.status === 'draft' || event.status === 'open';
  const acts = useApi<{ activities: Activity[] }>(manageActivities ? `/events/${event.id}/activities` : null);
  const meals = useApi<{ meals: Meal[] }>(manageMeals ? `/events/${event.id}/meals` : null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ day: string; start: number } | null>(null);
  const today = todayInZone(tz);
  const [phoneDay, setPhoneDay] = useState(days.includes(today) ? today : days[0]!);
  const gridRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number; offset: number; length: number; pointerId: number } | null>(null);
  /** A drag just ended: swallow the click that follows it. */
  const justDragged = useRef(false);
  const open = (key: string) => {
    if (justDragged.current) {
      justDragged.current = false;
      return;
    }
    setSelected(key);
  };

  const items: Item[] = useMemo(() => {
    const make = (kind: 'activity' | 'meal', id: string, name: string, location: string, status: string, startsAt: string | null, endsAt: string | null, extra: Partial<Item>): Item => {
      const day = startsAt ? dayInZone(startsAt, tz) : null;
      const start = startsAt ? toMin(clockInZone(startsAt, tz)) : 0;
      let end = endsAt ? toMin(clockInZone(endsAt, tz)) : start + DEFAULT_LENGTH;
      if (endsAt && dayInZone(endsAt, tz) !== day) end = 24 * 60;
      if (end <= start) end = start + SNAP;
      return { key: `${kind}:${id}`, id, kind, name, location, cancelled: status === 'cancelled', day: day && days.includes(day) ? day : null, start, end, openEnded: !endsAt, program: false, ...extra };
    };
    return [
      ...(acts.data?.activities ?? []).map((a) => make('activity', a.id, a.name, a.location, a.status, a.startsAt, a.endsAt, { activity: a, program: a.kind === 'program' })),
      ...(meals.data?.meals ?? []).map((m) => make('meal', m.id, m.name, m.location, m.status, m.startsAt, m.endsAt, { meal: m })),
    ];
  }, [acts.data, meals.data, tz, days]);

  const timed = items.filter((i) => i.day);
  const untimed = items.filter((i) => !i.day);
  const firstHour = Math.min(7, ...timed.map((i) => Math.floor(i.start / 60)));
  const lastHour = Math.max(21, ...timed.map((i) => Math.ceil(i.end / 60)));
  const top = firstHour * 60;
  const height = (lastHour - firstHour) * 60 * PX;
  const shownDays = wide ? days : [phoneDay];
  const reload = async () => {
    await Promise.all([acts.reload(), meals.reload()]);
  };
  const fail = (err: unknown) => toast(err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.', { tone: 'error' });

  async function setTime(it: Item, day: string | null, start: number, end: number | null, quiet = false) {
    const path = `/events/${event.id}/${it.kind === 'activity' ? 'activities' : 'meals'}/${it.id}`;
    const before = it.kind === 'activity' ? { startsAt: it.activity!.startsAt, endsAt: it.activity!.endsAt } : { startsAt: it.meal!.startsAt, endsAt: it.meal!.endsAt };
    const body = day ? { startsAt: zonedIso(day, toHHMM(start), tz), endsAt: end === null ? null : zonedIso(day, toHHMM(Math.min(end, 24 * 60 - 1)), tz) } : { startsAt: null, endsAt: null };
    try {
      await api(path, { method: 'PATCH', body });
      await reload();
      if (!quiet)
        toast(day ? `${it.name} moved to ${dayLabel(day)}, ${label(start)}` : `${it.name} has no set time now`, {
          undo: async () => {
            await api(path, { method: 'PATCH', body: before });
            await reload();
          },
        });
    } catch (err) {
      fail(err);
    }
  }

  // ---------------------------------------------------------------- dragging (mouse and pen; touch uses the panel)

  function locate(clientX: number, clientY: number, offset: number): { day: string; minute: number } | null {
    const grid = gridRef.current;
    if (!grid) return null;
    const cols = [...grid.querySelectorAll<HTMLElement>('[data-day]')];
    const col = cols.find((c) => {
      const r = c.getBoundingClientRect();
      return clientX >= r.left && clientX <= r.right;
    });
    if (!col) return null;
    const r = col.getBoundingClientRect();
    const raw = top + (clientY - r.top - offset) / PX;
    return { day: col.dataset.day!, minute: Math.round(raw / SNAP) * SNAP };
  }

  // The latest drag state and handlers, for the window listeners a drag adds.
  const dragRef = useRef<Drag | null>(null);
  const update = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };
  const handlers = useRef<{ move: (e: PointerEvent) => void; end: () => void }>({ move: () => undefined, end: () => undefined });

  function startDrag(e: ReactPointerEvent, it: Item, mode: 'move' | 'resize') {
    if (!editable || e.pointerType === 'touch' || e.button !== 0) return;
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    const rect = (mode === 'resize' ? el.parentElement! : el).getBoundingClientRect();
    pointer.current = { x: e.clientX, y: e.clientY, offset: it.day ? e.clientY - rect.top : 0, length: it.end - it.start, pointerId: e.pointerId };
    update({ key: it.key, mode, day: it.day ?? days[0]!, start: it.start, end: it.end, moved: false });
    // Follow the pointer across the whole page: the session may be redrawn in another day's column.
    const move = (ev: PointerEvent) => handlers.current.move(ev);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      handlers.current.end();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  const onMove = (e: PointerEvent) => {
    const p = pointer.current;
    const d = dragRef.current;
    if (!d || !p) return;
    const moved = d.moved || Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) > 4;
    if (!moved) return;
    if (d.mode === 'resize') {
      const at = locate(e.clientX, e.clientY, 0);
      if (!at) return;
      update({ ...d, moved, end: Math.max(d.start + SNAP, Math.min(at.minute, lastHour * 60)) });
      return;
    }
    const at = locate(e.clientX, e.clientY, p.offset);
    if (!at) return update({ ...d, moved });
    const start = Math.max(top, Math.min(at.minute, lastHour * 60 - p.length));
    update({ ...d, moved, day: at.day, start, end: start + p.length });
  };

  const onEnd = () => {
    const d = dragRef.current;
    pointer.current = null;
    update(null);
    if (!d || !d.moved) return;
    justDragged.current = true;
    // Clear it if no click follows (the pointer ended outside the session).
    window.setTimeout(() => (justDragged.current = false), 300);
    const it = items.find((i) => i.key === d.key);
    if (!it || (d.day === it.day && d.start === it.start && d.end === it.end)) return;
    void setTime(it, d.day, d.start, it.openEnded && d.mode === 'move' ? null : d.end);
  };

  // Keep the window listeners pointing at this render's handlers (they read the latest state).
  useEffect(() => {
    handlers.current = { move: onMove, end: onEnd };
  });

  // ---------------------------------------------------------------- render

  if ((acts.loading && !acts.data) || (meals.loading && !meals.data))
    return (
      <>
        <PageHeader title="Schedule" />
        <Loading what="the schedule">
          <SkeletonRows rows={6} />
        </Loading>
      </>
    );
  const loadError = acts.error ?? meals.error;
  if (loadError)
    return (
      <>
        <PageHeader title="Schedule" />
        <LoadError error={loadError} onRetry={reload} what="the schedule" />
      </>
    );

  const sel = items.find((i) => i.key === selected) ?? null;
  const placed = (it: Item) => (drag?.key === it.key ? { ...it, day: drag.day, start: drag.start, end: drag.end } : it);

  return (
    <>
      <PageHeader
        title="Schedule"
        summary={`${plural(timed.length, 'session')} across ${plural(days.length, 'day')}`}
        primary={
          manageActivities && (
            <ButtonLink to={`${base}/activities/import`} kind="primary">
              Import programme
            </ButtonLink>
          )
        }
        menu={[manageActivities && { label: 'Add activity', to: `${base}/activities/new` }, { label: 'Print schedule', onSelect: () => window.print() }]}
      />
      <div className="sections">
        <p className="meta no-print">
          {editable
            ? wide
              ? 'Drag a session to move it, or drag its bottom edge to change its length. Click a session for details, or an empty space to add one.'
              : 'Tap a session to change its time or open it. Tap an empty space to add one.'
            : 'This event is closed, so the schedule is read-only.'}
        </p>
        {!wide && <FilterTabs label="Day" value={phoneDay} onChange={setPhoneDay} options={days.map((d) => ({ value: d, label: d === today ? `Today, ${dayLabel(d)}` : dayLabel(d) }))} />}

        {items.length === 0 ? (
          <EmptyState
            title="Nothing scheduled yet"
            actions={
              manageActivities && (
                <>
                  <ButtonLink to={`${base}/activities/import`} kind="primary">
                    Import programme
                  </ButtonLink>
                  <ButtonLink to={`${base}/activities/new`}>Add activity</ButtonLink>
                </>
              )
            }
          >
            Import the programme from a spreadsheet, or add activities one at a time.
          </EmptyState>
        ) : (
          <div className="schedule-wrap">
            {untimed.length > 0 && (
              <section className="schedule-tray" aria-labelledby="tray-heading">
                <h2 id="tray-heading">No set time</h2>
                <p className="meta">{wide && editable ? 'Drag one onto the schedule to give it a time.' : 'Tap one to give it a time.'}</p>
                <ul>
                  {untimed.map((it) => (
                    <li key={it.key}>
                      <button
                        type="button"
                        className={`schedule-chip schedule-${it.program ? 'program' : it.kind}${it.cancelled ? ' is-cancelled' : ''}${drag?.key === it.key && drag.moved ? ' is-lifted' : ''}`}
                        onPointerDown={(e) => startDrag(e, it, 'move')}
                        onClick={() => open(it.key)}
                      >
                        <span className="schedule-name">{it.name}</span>
                        <span className="schedule-meta">{[it.kind === 'meal' ? 'Meal' : it.program ? 'Programme' : null, it.location].filter(Boolean).join(' · ') || 'Activity'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="schedule-scroll">
              <div className="schedule" ref={gridRef} style={{ ['--cols' as string]: shownDays.length }}>
                <div className="schedule-corner" aria-hidden="true" />
                {shownDays.map((d) => (
                  <h2 key={d} className={d === today ? 'schedule-day is-today' : 'schedule-day'}>
                    {dayLabel(d)}
                    {d === today && <span className="visually-hidden"> (today)</span>}
                  </h2>
                ))}
                <div className="schedule-axis" style={{ height }} aria-hidden="true">
                  {Array.from({ length: lastHour - firstHour }, (_, i) => (
                    <span key={i} style={{ top: i * 60 * PX }}>
                      {hourLabel(firstHour + i)}
                    </span>
                  ))}
                </div>
                {shownDays.map((d) => {
                  const here = timed.map(placed).filter((i) => i.day === d);
                  if (drag?.moved && !here.some((i) => i.key === drag.key) && drag.day === d) {
                    const lifted = items.find((i) => i.key === drag.key);
                    if (lifted) here.push({ ...lifted, day: d, start: drag.start, end: drag.end });
                  }
                  const lanes = layout(here);
                  return (
                    // A column of the grid. Clicking empty space adds a session there; the same is reachable with Add activity.
                    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
                    <div
                      key={d}
                      data-day={d}
                      className="schedule-col"
                      style={{ height, ['--hour' as string]: `${60 * PX}px` }}
                      onClick={(e) => {
                        if (!editable || e.target !== e.currentTarget) return;
                        const r = e.currentTarget.getBoundingClientRect();
                        const minute = Math.floor((top + (e.clientY - r.top) / PX) / 30) * 30;
                        setAdding({ day: d, start: minute });
                      }}
                    >
                      {here.map((it) => {
                        const lane = lanes.get(it.key) ?? { lane: 0, lanes: 1 };
                        const lifted = drag?.key === it.key && drag.moved;
                        return (
                          <button
                            key={it.key}
                            type="button"
                            className={`schedule-item schedule-${it.program ? 'program' : it.kind}${it.cancelled ? ' is-cancelled' : ''}${lifted ? ' is-lifted' : ''}${it.end - it.start <= 30 ? ' is-short' : ''}`}
                            style={{
                              top: (it.start - top) * PX,
                              height: Math.max((it.end - it.start) * PX, 22),
                              left: `calc(${(lane.lane / lane.lanes) * 100}% + 2px)`,
                              width: `calc(${100 / lane.lanes}% - 4px)`,
                            }}
                            aria-label={`${it.name}, ${it.kind === 'meal' ? 'meal, ' : it.program ? 'programme, ' : ''}${dayLabel(d)} ${label(it.start)}${it.openEnded ? '' : ` to ${label(it.end)}`}${it.cancelled ? ', cancelled' : ''}`}
                            onPointerDown={(e) => startDrag(e, it, 'move')}
                            onClick={() => open(it.key)}
                          >
                            <span className="schedule-time">
                              {label(it.start)}
                              {it.openEnded ? '' : `–${label(it.end)}`}
                            </span>
                            <span className="schedule-name">{it.name}</span>
                            {it.location && <span className="schedule-meta">{it.location}</span>}
                            {editable && wide && (
                              <span
                                className="schedule-resize"
                                aria-hidden="true"
                                onPointerDown={(e) => startDrag(e, it, 'resize')}
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        <p className="meta schedule-key no-print">
          <span className="schedule-swatch schedule-activity" aria-hidden="true" /> Activity <span className="schedule-swatch schedule-meal" aria-hidden="true" /> Meal{' '}
          <span className="schedule-swatch schedule-program" aria-hidden="true" /> Programme{' '}
          <span className="schedule-swatch is-cancelled" aria-hidden="true" /> Cancelled
        </p>
      </div>

      <Sheet open={sel !== null} title={sel?.name ?? ''} onClose={() => setSelected(null)}>
        {sel && (
          <SessionPanel
            key={sel.key}
            it={sel}
            days={days}
            editable={editable}
            base={base}
            onClose={() => setSelected(null)}
            onTime={(day, start, end) => setTime(sel, day, start, end)}
            onDuplicate={async () => {
              try {
                const after = sel.day ? { day: sel.day, start: sel.end, end: sel.end + (sel.end - sel.start) } : null;
                const time = after ? { startsAt: zonedIso(after.day, toHHMM(after.start), tz), endsAt: sel.openEnded ? null : zonedIso(after.day, toHHMM(Math.min(after.end, 1439)), tz) } : {};
                if (sel.kind === 'activity') {
                  const a = sel.activity!;
                  await api(`/events/${event.id}/activities`, {
                    body: {
                      name: a.name,
                      description: a.description,
                      location: a.location,
                      instructions: a.instructions,
                      capacity: a.capacity,
                      capacityPolicy: a.capacityPolicy,
                      trackSignOut: a.trackSignOut,
                      allowRepeat: a.allowRepeat,
                      bookingRequired: a.bookingRequired,
                      signupOpen: a.signupOpen,
                      kind: a.kind,
                      ...time,
                    },
                  });
                } else {
                  await api(`/events/${event.id}/meals`, { body: { name: sel.meal!.name, location: sel.meal!.location, ...time } });
                }
                await reload();
                setSelected(null);
                toast(after ? `Copy of ${sel.name} added at ${label(after.start)}` : `Copy of ${sel.name} added`);
              } catch (err) {
                fail(err);
              }
            }}
            onCancel={async () => {
              const path = `/events/${event.id}/${sel.kind === 'activity' ? 'activities' : 'meals'}/${sel.id}`;
              const status = sel.cancelled ? 'active' : 'cancelled';
              try {
                await api(path, { method: 'PATCH', body: { status } });
                await reload();
                toast(status === 'cancelled' ? `${sel.name} cancelled` : `${sel.name} restored`, {
                  undo: async () => {
                    await api(path, { method: 'PATCH', body: { status: status === 'cancelled' ? 'active' : 'cancelled' } });
                    await reload();
                  },
                });
              } catch (err) {
                fail(err);
              }
            }}
            onDelete={async () => {
              try {
                if (await deleteContext(confirm, event.id, sel.kind === 'activity' ? 'activities' : 'meals', sel.id, sel.name)) {
                  setSelected(null);
                  await reload();
                  toast(`Deleted ${sel.name}`);
                }
              } catch (err) {
                fail(err);
              }
            }}
          />
        )}
      </Sheet>

      <Sheet open={adding !== null} title="Add a session" onClose={() => setAdding(null)}>
        {adding && (
          <AddPanel
            at={adding}
            days={days}
            canActivity={manageActivities}
            canMeal={manageMeals}
            onAdd={async (kind, body) => {
              try {
                await api(`/events/${event.id}/${kind === 'activity' ? 'activities' : 'meals'}`, { body });
                await reload();
                setAdding(null);
                toast(`${body.name} added`);
              } catch (err) {
                fail(err);
              }
            }}
            tz={tz}
            onCancel={() => setAdding(null)}
          />
        )}
      </Sheet>
    </>
  );
}

/** Details of one session, and every change the grid can make, without dragging. */
function SessionPanel({
  it,
  days,
  editable,
  base,
  onClose,
  onTime,
  onDuplicate,
  onCancel,
  onDelete,
}: {
  it: Item;
  days: string[];
  editable: boolean;
  base: string;
  onClose: () => void;
  onTime: (day: string | null, start: number, end: number | null) => Promise<void>;
  onDuplicate: () => Promise<void>;
  onCancel: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [day, setDay] = useState(it.day ?? '');
  const [start, setStart] = useState(it.day ? toHHMM(it.start) : '09:00');
  const [end, setEnd] = useState(it.day && !it.openEnded ? toHHMM(it.end) : '');
  const [problem, setProblem] = useState<string | null>(null);
  const a = it.activity;
  async function save(e: FormEvent) {
    e.preventDefault();
    if (day && end && end <= start) return setProblem('The end must be after the start');
    setProblem(null);
    await onTime(day || null, toMin(start), day && end ? toMin(end) : null);
    onClose();
  }
  return (
    <>
      <p className="schedule-panel-meta">
        <Badge tone={it.kind === 'meal' ? 'info' : it.program ? 'neutral' : 'brand'}>{it.kind === 'meal' ? 'Meal' : it.program ? 'Programme' : 'Activity'}</Badge>
        {a?.bookingRequired && <Badge tone="brand">Booking required</Badge>}
        {it.cancelled && <Badge>Cancelled</Badge>}
        {it.location && <span>{it.location}</span>}
        {a && !it.program && <span>{a.capacity ? `${a.booked} of ${a.capacity} booked` : `${a.booked} booked`}</span>}
      </p>
      {editable && (
        <form className="form" onSubmit={(e) => void save(e)} noValidate>
          <Field id="sp-day" label="Day">
            <select className="select" value={day} onChange={(e) => setDay(e.target.value)}>
              <option value="">No set time</option>
              {days.map((d) => (
                <option key={d} value={d}>
                  {dayLabel(d, 'long')}
                </option>
              ))}
            </select>
          </Field>
          {day && (
            <div className="field-pair">
              <Field id="sp-start" label="Start">
                <input className="input" type="time" step={300} value={start} onChange={(e) => setStart(e.target.value)} />
              </Field>
              <Field id="sp-end" label="End" optional error={problem ?? undefined}>
                <input className="input" type="time" step={300} value={end} onChange={(e) => setEnd(e.target.value)} />
              </Field>
            </div>
          )}
          <div className="btn-row">
            <Button type="submit" kind="primary">
              Save time
            </Button>
          </div>
        </form>
      )}
      <div className="btn-row">
        {a && (
          <ButtonLink to={`${base}/activities/${a.id}`}>
            Open activity
            <Icon name="chevron" />
          </ButtonLink>
        )}
        {a && editable && <ButtonLink to={`${base}/activities/${a.id}/edit`}>Edit details</ButtonLink>}
        {editable && (
          <Button onAction={onDuplicate} busyLabel="Copying…">
            Duplicate
          </Button>
        )}
      </div>
      {editable && (
        <div className="btn-row schedule-panel-danger">
          <Button kind="ghost" onAction={onCancel}>
            {it.cancelled ? `Restore ${it.kind}` : `Cancel ${it.kind}`}
          </Button>
          <Button kind="ghost" className="is-danger-text" onAction={onDelete}>
            Delete {it.kind}…
          </Button>
        </div>
      )}
      {it.kind === 'meal' && <Link to={`${base}/meals`}>All meals</Link>}
    </>
  );
}

/** Click an empty spot: add an activity or meal right there. */
function AddPanel({
  at,
  days,
  canActivity,
  canMeal,
  tz,
  onAdd,
  onCancel,
}: {
  at: { day: string; start: number };
  days: string[];
  canActivity: boolean;
  canMeal: boolean;
  tz: string;
  onAdd: (kind: 'activity' | 'meal', body: { name: string; location: string; startsAt: string; endsAt: string | null }) => Promise<void>;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<'activity' | 'meal'>(canActivity ? 'activity' : 'meal');
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [day, setDay] = useState(at.day);
  const [start, setStart] = useState(toHHMM(at.start));
  const [end, setEnd] = useState(toHHMM(Math.min(at.start + DEFAULT_LENGTH, 1439)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!name.trim()) found.name = 'Enter a name';
    if (end && end <= start) found.end = 'The end must be after the start';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    await onAdd(kind, { name: name.trim(), location: location.trim(), startsAt: zonedIso(day, start, tz), endsAt: end ? zonedIso(day, end, tz) : null });
    setBusy(false);
  }
  return (
    <form className="form" onSubmit={(e) => void submit(e)} noValidate>
      {canActivity && canMeal && (
        <Segmented
          label="What are you adding?"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'activity', label: 'Activity' },
            { value: 'meal', label: 'Meal' },
          ]}
        />
      )}
      <Field id="ap-name" label="Name" error={errors.name}>
        {/* The panel opens because they clicked a spot to add something: start typing straight away. */}
        {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
        <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </Field>
      <Field id="ap-day" label="Day">
        <select className="select" value={day} onChange={(e) => setDay(e.target.value)}>
          {days.map((d) => (
            <option key={d} value={d}>
              {dayLabel(d, 'long')}
            </option>
          ))}
        </select>
      </Field>
      <div className="field-pair">
        <Field id="ap-start" label="Start">
          <input className="input" type="time" step={300} value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field id="ap-end" label="End" optional error={errors.end}>
          <input className="input" type="time" step={300} value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <Field id="ap-place" label="Place" optional>
        <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} autoComplete="off" />
      </Field>
      <div className="btn-row">
        <Button type="submit" kind="primary" busy={busy} busyLabel="Adding…">
          Add {kind}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
