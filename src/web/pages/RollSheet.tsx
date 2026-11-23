import { useState } from 'react';
import type { Registration } from '../model';
import { useApi } from '../useApi';
import { Button, Icon, LoadError, Loading, PageHeader, Segmented, SkeletonRows, plural } from '../ui';
import { useEvent } from './EventLayout';

/**
 * People › Print roll sheet: a paper backup for when phones, lanyards or
 * signal fail. Tick by hand, then enter the ticks later with Find by name.
 */
export function RollSheet() {
  const { event, base: eventBase } = useEvent();
  const { data, error, loading, reload } = useApi<{ registrations: Registration[] }>(`/events/${event.id}/registrations`);
  const [title, setTitle] = useState('');
  const [who, setWho] = useState<'all' | 'youth' | 'adult'>('all');
  const [group, setGroup] = useState('');
  const [columns, setColumns] = useState('In, Out');
  const back = { to: `${eventBase}/people`, label: 'People' };

  const active = (data?.registrations ?? []).filter((r) => r.status === 'active');
  const people = active
    .filter((r) => (who === 'all' || r.kind === who) && (!group || r.groupName === group))
    .sort((a, b) => a.groupName.localeCompare(b.groupName) || a.lastName.localeCompare(b.lastName));
  const groups = [...new Set(active.map((r) => r.groupName).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  const header = (
    <div className="no-print">
      <PageHeader
        title="Print roll sheet"
        back={back}
        summary={data && plural(people.length, 'person', 'people')}
        help="A paper backup. If phones, lanyards or signal fail, tick names by hand and enter them later with Find by name on the scanner."
        primary={
          data && (
            <Button kind="primary" onClick={() => window.print()}>
              <Icon name="print" />
              Print
            </Button>
          )
        }
      />
    </div>
  );

  if (loading && !data)
    return (
      <>
        {header}
        <Loading what="roll sheet">
          <SkeletonRows rows={8} />
        </Loading>
      </>
    );
  if (error)
    return (
      <>
        {header}
        <LoadError error={error} onRetry={reload} what="the roll sheet" />
      </>
    );
  const cols = columns
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 6);

  return (
    <>
      {header}
      <div className="sections roll-page">
        <div className="panel roll-options no-print">
          <div className="field roll-who">
            <span className="field-label">Who</span>
            <Segmented
              label="Who"
              value={who}
              onChange={setWho}
              options={[
                { value: 'all', label: 'Everyone' },
                { value: 'youth', label: 'Youth' },
                { value: 'adult', label: 'Leaders' },
              ]}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="rs-group">
              Scout group
            </label>
            <select id="rs-group" className="select" value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">All groups</option>
              {groups.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="rs-title">
              Heading <span className="field-optional">(optional)</span>
            </label>
            <input id="rs-title" className="input" value={title} placeholder="Saturday lunch" onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="rs-cols">
              Tick columns
            </label>
            <input id="rs-cols" className="input" value={columns} aria-describedby="rs-cols-hint" onChange={(e) => setColumns(e.target.value)} />
            <span className="field-hint" id="rs-cols-hint">
              Comma separated, up to six
            </span>
          </div>
        </div>

        <div className="roll-sheet">
          <p className="roll-title">
            <strong>{title || 'Roll sheet'}</strong>
            {group && ` · ${group}`} · {event.name} · printed {new Date().toLocaleDateString('en-AU')}. Contains personal information: keep it secure and shred after use.
          </p>
          <div className="table-wrap">
            <table className="table roll">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Scout group</th>
                  {cols.map((c) => (
                    <th scope="col" key={c} className="tick">
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
        </div>
      </div>
    </>
  );
}
