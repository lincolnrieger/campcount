import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon';
import { Loading, Notice } from '../components/ui';
import type { ScanTarget } from '../scan/targets';
import { canScan, rememberScanEvent, useLastScan, useScanEvent, useScanTargets } from '../scan/targets';
import type { EventSummary } from '../types';
import { useApi } from '../useApi';
import { dayLabel, eventDays, todayInZone } from '../../shared/time';

/** The Scan tab: pick an event (if more than one), then what to scan. */
export function ScanHub() {
  const { data, error, loading } = useApi<{ events: EventSummary[] }>('/events');
  const [params, setParams] = useSearchParams();
  const stored = useScanEvent();
  const last = useLastScan();
  const events = (data?.events ?? []).filter(canScan);
  const wanted = params.get('event') ?? stored;
  const event = events.find((e) => e.id === wanted) ?? events[0] ?? null;

  useEffect(() => {
    if (event) rememberScanEvent(event.id);
  }, [event]);

  if ((loading && !data) || stored === undefined) return <Loading />;
  if (error) return <Notice tone="stop">{error.message}</Notice>;

  if (!event) {
    return (
      <>
        <h1>Scan</h1>
        <div className="empty">
          <p>
            <strong>Nothing to scan right now.</strong>
          </p>
          <p className="lede">Scanning opens when an event manager opens the event and adds you as a Scanner or to the Meal team.</p>
        </div>
      </>
    );
  }

  return (
    <div className="scan-hub">
      <h1>Scan</h1>
      {events.length > 1 ? (
        <div className="field">
          <label htmlFor="scan-event" className="visually-hidden">
            Event
          </label>
          <select id="scan-event" className="input" value={event.id} onChange={(e) => setParams({ event: e.target.value }, { replace: true })}>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="lede">{event.name}</p>
      )}
      {last && last.eventId === event.id && (
        <Link to={last.to} className="resume">
          <span>
            <span className="resume-kicker">Carry on scanning</span>
            <strong>{last.label}</strong>
          </span>
          <Icon name="chevron" />
        </Link>
      )}
      <ScanTargetPicker event={event} />
    </div>
  );
}

/** Day strip plus Gate / Meals / Activities lists. Used on the Scan tab and in the scanner's switch sheet. */
export function ScanTargetPicker({
  event,
  currentKey,
  onPick,
  onDismiss,
}: {
  event: EventSummary;
  currentKey?: string;
  onPick?: () => void;
  onDismiss?: () => void;
}) {
  const { targets, offline } = useScanTargets(event);
  const navigate = useNavigate();
  const days = eventDays(event.startsOn, event.endsOn);
  const today = todayInZone(event.timezone);
  const current = targets?.find((t) => t.key === currentKey);
  const usedDays = days.filter((d) => targets?.some((t) => t.day === d));
  const [day, setDay] = useState<string | null>(null);
  const shownDay = day ?? current?.day ?? (usedDays.includes(today) ? today : (usedDays[0] ?? null));

  if (!targets) return <Loading />;
  if (targets.length === 0) {
    return <p className="lede">{offline ? 'No signal, and this phone has not loaded this event yet.' : 'Nothing is set up to scan at this event yet.'}</p>;
  }

  const go = (t: ScanTarget) => {
    if (t.key === currentKey) {
      onDismiss?.();
      return;
    }
    onPick?.();
    navigate(t.to, { replace: Boolean(currentKey) });
  };
  const gate = targets.filter((t) => t.type === 'site');
  const meals = targets.filter((t) => t.type === 'meal' && (usedDays.length < 2 || t.day === shownDay || t.day === null));
  const activities = targets.filter((t) => t.type === 'activity' && (t.day === null || usedDays.length < 2 || t.day === shownDay));

  return (
    <>
      {offline && <p className="field-hint">No signal: showing the list saved on this phone.</p>}
      {usedDays.length > 1 && (
        <div className="day-strip" role="tablist" aria-label="Day">
          {usedDays.map((d) => (
            <button key={d} type="button" role="tab" aria-selected={d === shownDay} onClick={() => setDay(d)}>
              <span>{dayLabel(d).split(' ')[0]}</span>
              <strong>{dayLabel(d).split(' ')[1]}</strong>
              {d === today && <em>Today</em>}
            </button>
          ))}
        </div>
      )}
      <TargetList title="Gate" items={gate} currentKey={currentKey} onGo={go} />
      <TargetList title="Meals" items={meals} currentKey={currentKey} onGo={go} />
      <TargetList title="Activities" items={activities} currentKey={currentKey} onGo={go} />
    </>
  );
}

function TargetList({ title, items, currentKey, onGo }: { title: string; items: ScanTarget[]; currentKey?: string; onGo: (t: ScanTarget) => void }) {
  if (items.length === 0) return null;
  return (
    <section className="list-section">
      <h2 className="list-heading">{title}</h2>
      <ul className="list">
        {items.map((t) => (
          <li key={t.key}>
            <button type="button" className="list-row list-button" aria-current={t.key === currentKey ? 'true' : undefined} onClick={() => onGo(t)}>
              <span className="list-main">
                <strong>{t.label}</strong>
                <span>{t.hint}</span>
              </span>
              {t.key === currentKey ? <span className="list-check">Scanning</span> : <Icon name="chevron" />}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Bottom sheet for switching what the scanner is scanning, without leaving the scanner. */
export function ScanSwitcher({
  event,
  currentKey,
  open,
  onClose,
  onSwitch,
}: {
  event: EventSummary;
  currentKey: string;
  open: boolean;
  onClose: () => void;
  onSwitch: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={dialog} className="sheet-dialog" onClose={onClose} aria-labelledby="switch-title">
      <div className="sheet-head">
        <h2 id="switch-title">Scan for</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
      </div>
      {open && <ScanTargetPicker
          event={event}
          currentKey={currentKey}
          onPick={() => {
            onSwitch();
            onClose();
          }}
          onDismiss={onClose}
        />}
    </dialog>
  );
}
