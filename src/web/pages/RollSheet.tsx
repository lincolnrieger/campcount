import { useState } from 'react';
import { Loading, Notice } from '../components/ui';
import { useApi } from '../useApi';
import { useEvent } from './EventLayout';
import type { Registration } from './Roster';

/**
 * Paper fallback for when phones, cards or signal fail. Print before camp;
 * tick by hand; enter the ticks afterwards with "Find by name" (recorded as
 * manual entries).
 */
export function RollSheet() {
  const { event } = useEvent();
  const { data, error, loading } = useApi<{ registrations: Registration[] }>(`/events/${event.id}/registrations`);
  const [title, setTitle] = useState('');
  const [who, setWho] = useState<'all' | 'youth' | 'adult'>('all');
  const [columns, setColumns] = useState('In, Out');

  if (loading && !data) return <Loading />;
  if (error) return <Notice tone="stop">{error.message}</Notice>;
  const people = (data?.registrations ?? [])
    .filter((r) => r.status === 'active' && (who === 'all' || r.kind === who))
    .sort((a, b) => a.groupName.localeCompare(b.groupName) || a.lastName.localeCompare(b.lastName));
  const cols = columns
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 6);

  return (
    <>
      <div className="no-print narrow">
        <p>
          Print this before camp as a backup. If phones, cards or signal fail, tick names by hand, write the time, and enter the ticks later
          using Find by name on the scanning screen (recorded as manual entries).
        </p>
        <div className="row">
          <div className="field">
            <label htmlFor="rs-title">Heading</label>
            <input id="rs-title" className="input" placeholder="For example, Saturday lunch" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="rs-cols">Tick columns</label>
            <input id="rs-cols" className="input" value={columns} onChange={(e) => setColumns(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="rs-who">Who</label>
            <select id="rs-who" className="input" value={who} onChange={(e) => setWho(e.target.value as typeof who)}>
              <option value="all">Everyone</option>
              <option value="youth">Youth only</option>
              <option value="adult">Adults only</option>
            </select>
          </div>
        </div>
        <button className="btn" onClick={() => window.print()}>
          Print roll sheet
        </button>
      </div>
      <div className="roll-sheet">
        <p className="roll-title">
          <strong>{title || 'Roll sheet'}</strong> {event.name}. Printed {new Date().toLocaleDateString('en-AU')}. Contains personal
          information: keep secure and shred after use.
        </p>
        <table className="sheet roll">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Group</th>
              {cols.map((c) => (
                <th scope="col" key={c}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.preferredName || p.firstName} {p.lastName}
                </td>
                <td>{p.groupName}</td>
                {cols.map((c) => (
                  <td key={c} className="tick" />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
