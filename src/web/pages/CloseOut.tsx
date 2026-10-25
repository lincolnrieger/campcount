import { useState } from 'react';
import { ApiFailure, api } from '../api';
import { Loading, Notice, SkeletonList } from '../components/ui';
import { useApi } from '../useApi';
import { useEvent } from './EventLayout';
import { minutesAgo } from './Live';

interface Item {
  kind: 'still_present' | 'review' | 'unknown_card';
  contextKey: string;
  contextName: string;
  name: string;
  detail: string;
  at: string | null;
  scanId: string | null;
}

export function Exports() {
  const { event } = useEvent();
  const { data } = useApi<{ exports: { key: string; label: string }[] }>(`/events/${event.id}/exports`);
  if (!data || data.exports.length === 0) return null;
  return (
    <section aria-labelledby="exports-heading" className="section-gap">
      <h2 id="exports-heading">Downloads</h2>
      <p className="field-hint narrow">CSV files that open in Excel. Every download is recorded. Store them securely and delete them when no longer needed.</p>
      <ul className="launch">
        {data.exports.map((e) => (
          <li key={e.key}>
            <a href={`/api/events/${event.id}/exports/${e.key}.csv`} download>
              {e.label} <span>CSV</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CloseOut() {
  const { event, can, reload: reloadEvent } = useEvent();
  const rec = useApi<{ items: Item[]; devices: { deviceId: string; lastUpload: string; scans: number }[]; pendingDietary: number; timezone: string }>(
    `/events/${event.id}/reconciliation`,
  );
  const [message, setMessage] = useState<{ tone: 'ok' | 'stop'; text: string } | null>(null);
  const correct = can('attendance.correct') && (event.status === 'open' || event.status === 'completed');

  async function act(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      setMessage({ tone: 'ok', text: success });
      await rec.reload();
    } catch (err) {
      setMessage({ tone: 'stop', text: err instanceof ApiFailure ? err.message : 'Something went wrong.' });
    }
  }

  if (rec.loading && !rec.data)
    return (
      <Loading label="Loading close-out">
        <SkeletonList rows={4} aside="button" heading />
      </Loading>
    );
  if (rec.error) return <Notice tone="stop">{rec.error.message}</Notice>;
  const items = rec.data?.items ?? [];
  const groups = [...new Set(items.map((i) => i.contextKey))];
  const time = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: rec.data!.timezone }) : '';

  return (
    <>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <p className="narrow">
        Before closing the event, check that every phone has uploaded and resolve the records below. Scan records are operational records.
        They are not proof of where someone is and do not replace a roll call.
      </p>

      {(rec.data?.devices ?? []).length > 0 && (
        <details>
          <summary>Has every phone uploaded?</summary>
          <ul>
            {rec.data!.devices.map((d) => (
              <li key={d.deviceId}>
                Phone …{d.deviceId.slice(-4)}: last upload {minutesAgo(d.lastUpload)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {(rec.data?.pendingDietary ?? 0) > 0 && (
        <Notice tone="warn">{rec.data!.pendingDietary} people have dietary notes that still need review. Re-import the roster to review them.</Notice>
      )}

      {items.length === 0 ? (
        <Notice tone="ok" title="Nothing to reconcile">
          <p>No one is still signed in and no scans need checking.</p>
        </Notice>
      ) : (
        groups.map((key) => {
          const list = items.filter((i) => i.contextKey === key);
          const present = list.filter((i) => i.kind === 'still_present');
          return (
            <section key={key} className="section-gap">
              <h2>{list[0]!.contextName || 'Unknown'}</h2>
              {correct && present.length > 0 && (
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    const reason = window.prompt(
                      `Record ${present.length} ${key === 'site:' ? 'departures' : 'sign-outs'} now? Give a reason (kept in the record):`,
                      key === 'site:' ? 'Confirmed departed at end of camp' : 'Activity finished',
                    );
                    if (reason && reason.trim().length >= 3) {
                      void act(
                        () => api(`/events/${event.id}/reconciliation/sign-out-all`, { body: { contextKey: key, reason } }),
                        `Recorded ${present.length} ${key === 'site:' ? 'departures' : 'sign-outs'}.`,
                      );
                    }
                  }}
                >
                  {key === 'site:' ? `Record departure for all ${present.length}` : `Sign out all ${present.length}`}
                </button>
              )}
              <div className="sheet-wrap">
                <table className="sheet sheet-stack">
                  <tbody>
                    {list.map((i, n) => (
                      <tr key={`${i.scanId ?? i.name}-${n}`}>
                        <td>
                          <strong>{i.name}</strong>
                          <div className="field-hint">{time(i.at)}</div>
                        </td>
                        <td>{i.detail}</td>
                        <td className="num">
                          {correct && i.scanId && (
                            <button
                              className="btn-link"
                              onClick={() => {
                                const reason = window.prompt('Why should this scan not count? (kept in the record)');
                                if (reason && reason.trim().length >= 3) {
                                  void act(() => api(`/events/${event.id}/scans/${i.scanId}/void`, { body: { reason } }), 'Scan corrected.');
                                }
                              }}
                            >
                              Don't count this scan
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}

      <Exports />

      {event.status === 'open' && can('event.close') && (
        <section className="section-gap narrow">
          <h2>Close the event</h2>
          <p>Closing stops scanning and locks settings. You can reopen it for late corrections.</p>
          <button
            className="btn"
            onClick={() => {
              const warn = items.length > 0 ? `${items.length} records are unresolved. ` : '';
              if (window.confirm(`${warn}Close ${event.name}?`)) {
                void act(async () => {
                  await api(`/events/${event.id}/transition`, { body: { to: 'completed' } });
                  await reloadEvent();
                }, 'Event closed.');
              }
            }}
          >
            Close event
          </button>
        </section>
      )}
    </>
  );
}
