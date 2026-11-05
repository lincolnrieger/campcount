import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { ScanTarget } from '../scan/targets';
import { canScan, isOnNow, rememberScanEvent, useLastScan, useScanEvent, useScanTargets } from '../scan/targets';
import type { EventSummary } from '../types';
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
      <PageHeader title="Scan" summary={events.length === 1 ? event.name : undefined} />
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
        <ScanTargetPicker event={event} />
      </div>
    </>
  );
}

/** "On now", then the gate, then the chosen day's meals and activities. Used on the Scan tab and in the scanner's Switch sheet. */
export function ScanTargetPicker({ event, currentKey, onPick, onDismiss }: { event: EventSummary; currentKey?: string; onPick?: () => void; onDismiss?: () => void }) {
  const { targets, offline } = useScanTargets(event);
  const navigate = useNavigate();
  const days = eventDays(event.startsOn, event.endsOn);
  const today = todayInZone(event.timezone);
  const current = targets?.find((t) => t.key === currentKey);
  const usedDays = days.filter((d) => targets?.some((t) => t.day === d));
  const [day, setDay] = useState<string | null>(null);
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
      <TargetList title="On now" items={onNow} currentKey={currentKey} onGo={go} large />
      <TargetList title="Gate" items={gate} currentKey={currentKey} onGo={go} large />
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

function TargetList({ title, items, currentKey, onGo, large }: { title: string; items: ScanTarget[]; currentKey?: string; onGo: (t: ScanTarget) => void; large?: boolean }) {
  if (items.length === 0) return null;
  return (
    <Section title={title} id={`scan-${title.toLowerCase().replace(/\W+/g, '-')}`}>
      <ul className="list">
        {items.map((t) => (
          <li key={t.key}>
            <button type="button" className={large ? 'row row-button row-large' : 'row row-button'} aria-current={t.key === currentKey ? 'true' : undefined} onClick={() => onGo(t)}>
              <span className="row-main">
                <span className="row-title">{t.label}</span>
                <span className="row-meta">{t.hint}</span>
              </span>
              {t.key === currentKey ? <Badge tone="brand">Scanning</Badge> : isOnNow(t) && title !== 'On now' ? <Badge tone="success">On now</Badge> : null}
              <Icon name="chevron" />
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
