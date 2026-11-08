import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { ScanTarget } from '../scan/targets';
import { canScan, isOnNow, rememberScanEvent, useLastScan, useScanEvent, useScanTargets } from '../scan/targets';
import type { EventSummary } from '../types';
import { scanOnly } from './EventLayout';
import { useApi } from '../useApi';
import { dayLabel, eventDays, todayInZone } from '../../shared/time';
import { Badge, EmptyState, FilterTabs, Icon, LoadError, Loading, PageHeader, Section, Sheet, SkeletonHeader, SkeletonRows } from '../ui';

/** The Scan tab: pick an event (if more than one), then what to scan, with what's on now first. */
export function ScanHub() {
  const { data, error, loading, reload } = useApi<{ events: EventSummary[] }>('/events');
  const [params, setParams] = useSearchParams();
  const stored = useScanEvent();
  const last = useLastScan();
  const events = (data?.events ?? []).filter(canScan);
  const wanted = params.get('event') ?? stored;
  const event = events.find((e) => e.id === wanted) ?? events[0] ?? null;

  useEffect(() => {
    if (event) rememberScanEvent(event.id);
  }, [event]);

  if ((loading && !data) || stored === undefined)
    return (
      <Loading what="what you can scan">
        <SkeletonHeader />
        <SkeletonRows rows={4} />
      </Loading>
    );
  if (error) return <LoadError error={error} onRetry={reload} what="your events" />;

  if (!event) {
    return (
      <>
        <PageHeader title="Scan" />
        <EmptyState title="Nothing to scan right now">
          Scanning starts when an event manager opens an event and adds you to its staff as a scanner, activity leader or meal team.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Scan" summary="Tap what you're scanning for. The camera opens straight away." />
      <div className="sections">
        {events.length > 1 && (
          <div className="field scan-event-pick">
            <label htmlFor="scan-event" className="field-label">
              Event
            </label>
            <select id="scan-event" className="select" value={event.id} onChange={(e) => setParams({ event: e.target.value }, { replace: true })}>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {last && last.eventId === event.id && (
          <ul className="list">
            <li className="row row-large row-link">
              <span className="row-main">
                <span className="row-meta">Carry on scanning</span>
                <span className="row-title">
                  <Link to={last.to}>{last.label}</Link>
                </span>
              </span>
              <span className="row-chevron">
                <Icon name="chevron" />
              </span>
            </li>
          </ul>
        )}
        <ScanTargetPicker event={event} autoOpen={scanOnly(event) && !params.get('pick')} />
      </div>
    </>
  );
}

/** "On now", then the gate, then the chosen day's meals and activities. Used on the Scan tab and in the scanner's Switch sheet. */
export function ScanTargetPicker({
  event,
  currentKey,
  onPick,
  onDismiss,
  autoOpen = false,
}: {
  event: EventSummary;
  currentKey?: string;
  onPick?: () => void;
  onDismiss?: () => void;
  /** Open the scanner straight away when there's only one thing to scan right now (for people who only scan). */
  autoOpen?: boolean;
}) {
  const { targets, offline } = useScanTargets(event);
  const navigate = useNavigate();
  const days = eventDays(event.startsOn, event.endsOn);
  const today = todayInZone(event.timezone);
  const current = targets?.find((t) => t.key === currentKey);
  const usedDays = days.filter((d) => targets?.some((t) => t.day === d));
  const [day, setDay] = useState<string | null>(null);
  const only = !targets ? null : targets.length === 1 ? targets[0]! : (() => {
    const on = targets.filter((t) => t.type !== 'site' && isOnNow(t));
    return on.length === 1 ? on[0]! : null;
  })();
  const onlyTo = only?.to;
  useEffect(() => {
    if (autoOpen && onlyTo) navigate(onlyTo, { replace: true });
  }, [autoOpen, onlyTo, navigate]);
  const shownDay = day ?? current?.day ?? (usedDays.includes(today) ? today : (usedDays[0] ?? ''));

  if (!targets)
    return (
      <Loading what="what you can scan">
        <SkeletonRows rows={4} />
      </Loading>
    );
  if (targets.length === 0) {
    return <EmptyState title="Nothing set up to scan yet">{offline ? 'No signal, and this phone has not loaded this event yet.' : 'An event manager adds meals and activities to scan.'}</EmptyState>;
  }

  const go = (t: ScanTarget) => {
    if (t.key === currentKey) {
      onDismiss?.();
      return;
    }
    onPick?.();
    navigate(t.to, { replace: Boolean(currentKey) });
  };
  const onNow = targets.filter((t) => t.type !== 'site' && isOnNow(t)).sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? ''));
  const now = new Set(onNow.map((t) => t.key));
  const gate = targets.filter((t) => t.type === 'site');
  const inDay = (t: ScanTarget) => t.day === null || usedDays.length < 2 || t.day === shownDay;
  const meals = targets.filter((t) => t.type === 'meal' && !now.has(t.key) && inDay(t));
  const activities = targets
    .filter((t) => t.type === 'activity' && !now.has(t.key) && inDay(t))
    .sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? '') || a.label.localeCompare(b.label));

  return (
    <>
      {offline && <p className="meta">No signal: showing the list saved on this phone.</p>}
      <TargetList title="On now" items={onNow} currentKey={currentKey} onGo={go} now />
      <TargetList title="Gate" items={gate} currentKey={currentKey} onGo={go} />
      {usedDays.length > 1 && (
        <FilterTabs
          label="Day"
          value={shownDay}
          onChange={setDay}
          options={usedDays.map((d) => ({ value: d, label: d === today ? `Today, ${dayLabel(d)}` : dayLabel(d) }))}
        />
      )}
      <TargetList title="Meals" items={meals} currentKey={currentKey} onGo={go} />
      <TargetList title="Activities" items={activities} currentKey={currentKey} onGo={go} />
    </>
  );
}

const KIND: Record<ScanTarget['type'], string> = { site: 'Gate', meal: 'Meal', activity: 'Activity' };

/** Big buttons: one tap opens the camera for that place. */
function TargetList({ title, items, currentKey, onGo, now }: { title: string; items: ScanTarget[]; currentKey?: string; onGo: (t: ScanTarget) => void; now?: boolean }) {
  if (items.length === 0) return null;
  return (
    <Section title={title} id={`scan-${title.toLowerCase().replace(/\W+/g, '-')}`}>
      <ul className="scan-tiles">
        {items.map((t) => (
          <li key={t.key}>
            <button type="button" className={now ? 'scan-tile is-now' : 'scan-tile'} aria-current={t.key === currentKey ? 'true' : undefined} onClick={() => onGo(t)}>
              {now && <span className="scan-tile-kind">{KIND[t.type]}</span>}
              <span className="scan-tile-title">{t.type === 'site' ? 'Arrivals and departures' : t.label}</span>
              {t.hint && t.hint !== KIND[t.type] && t.type !== 'site' && <span className="scan-tile-hint">{t.hint}</span>}
              {t.key === currentKey && <Badge tone="brand">Scanning</Badge>}
              <Icon name="scan" size={24} />
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** The scanner's Switch sheet: change what you're scanning without leaving the scanner. */
export function ScanSwitcher({ event, currentKey, open, onClose, onSwitch }: { event: EventSummary; currentKey: string; open: boolean; onClose: () => void; onSwitch: () => void }) {
  return (
    <Sheet open={open} title="Scan for" onClose={onClose}>
      <ScanTargetPicker
        event={event}
        currentKey={currentKey}
        onPick={() => {
          onSwitch();
          onClose();
        }}
        onDismiss={onClose}
      />
    </Sheet>
  );
}
