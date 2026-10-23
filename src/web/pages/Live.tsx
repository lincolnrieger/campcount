import { useEffect } from 'react';
import { Loading, Notice } from '../components/ui';
import { useApi } from '../useApi';
import { useEvent } from './EventLayout';

interface ContextSummary {
  key: string;
  type: 'activity' | 'meal' | 'site';
  name: string;
  status: string;
  capacity: number | null;
  trackSignOut: boolean;
  presentNow: number;
  people: number;
  duplicates: number;
  needsReview: number;
  expected: number | null;
}
interface LiveData {
  generatedAt: string;
  timezone: string;
  roster: { active: number; youth: number; adults: number; withdrawn: number };
  contexts: ContextSummary[];
  openItems: number;
  devices: { deviceId: string; lastUpload: string; scans: number }[];
}

export function minutesAgo(iso: string): string {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min ago` : `${Math.floor(h / 24)} days ago`;
}

export function Live() {
  const { event } = useEvent();
  const { data, error, loading, reload } = useApi<LiveData>(`/events/${event.id}/live`);
  useEffect(() => {
    const timer = setInterval(() => void reload(), 30_000);
    return () => clearInterval(timer);
  }, [reload]);

  if (loading && !data) return <Loading />;
  if (error) return <Notice tone="stop">{error.message}</Notice>;
  if (!data) return null;
  const at = new Date(data.generatedAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: data.timezone });
  const site = data.contexts.find((c) => c.type === 'site');
  const meals = data.contexts.filter((c) => c.type === 'meal' && c.status === 'active');
  const activities = data.contexts.filter((c) => c.type === 'activity' && c.status === 'active');

  return (
    <>
      <p className="lede">
        Recorded scans as of {at} ({data.timezone}), updating every 30 seconds. Phones without signal upload later, so recent numbers can
        rise.
      </p>
      {data.openItems > 0 && (
        <Notice tone="warn">
          <p>
            {data.openItems} records need checking before close-out. See <a href="close-out">Close-out</a>.
          </p>
        </Notice>
      )}
      <dl className="facts">
        <dt>On the roster</dt>
        <dd>
          {data.roster.active} ({data.roster.youth} youth, {data.roster.adults} adults)
        </dd>
        {site && (
          <>
            <dt>Recorded on site</dt>
            <dd>
              {site.presentNow} now, {site.people} arrived
            </dd>
          </>
        )}
      </dl>

      {meals.length > 0 && (
        <section>
          <h2>Meals</h2>
          <div className="sheet-wrap">
            <table className="sheet sheet-stack">
              <thead>
                <tr>
                  <th scope="col">Meal</th>
                  <th scope="col" className="num">Served</th>
                  <th scope="col" className="num">Not recorded</th>
                  <th scope="col" className="num">Repeat scans</th>
                </tr>
              </thead>
              <tbody>
                {meals.map((m) => (
                  <tr key={m.key}>
                    <td>
                      <strong>{m.name}</strong>
                    </td>
                    <td className="num" data-label="Served">
                      {m.people} of {m.expected}
                    </td>
                    <td className="num" data-label="Not recorded">
                      {(m.expected ?? 0) - m.people}
                    </td>
                    <td className="num" data-label="Repeat scans">
                      {m.duplicates}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activities.length > 0 && (
        <section className="section-gap">
          <h2>Activities</h2>
          <div className="sheet-wrap">
            <table className="sheet sheet-stack">
              <thead>
                <tr>
                  <th scope="col">Activity</th>
                  <th scope="col" className="num">There now</th>
                  <th scope="col" className="num">Different people</th>
                  <th scope="col" className="num">To check</th>
                </tr>
              </thead>
              <tbody>
                {activities.map((a) => (
                  <tr key={a.key}>
                    <td>
                      <strong>{a.name}</strong>
                    </td>
                    <td className="num" data-label="There now">
                      {a.trackSignOut ? `${a.presentNow}${a.capacity ? ` of ${a.capacity}` : ''}` : 'Not tracked'}
                    </td>
                    <td className="num" data-label="Different people">
                      {a.people}
                    </td>
                    <td className="num" data-label="To check">
                      {a.needsReview || ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {data.devices.length > 0 && (
        <details className="section-gap">
          <summary>Scanning phones ({data.devices.length})</summary>
          <p className="field-hint">If a phone has not uploaded for a while, it may be out of signal with scans waiting.</p>
          <ul>
            {data.devices.map((d) => (
              <li key={d.deviceId}>
                Phone …{d.deviceId.slice(-4)}: {d.scans} scans, last upload {minutesAgo(d.lastUpload)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
