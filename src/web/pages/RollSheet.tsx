import { useState } from 'react';
import type { Registration } from '../model';
import { useApi } from '../useApi';
import { Button, Field, Icon, LoadError, Loading, PageHeader, SkeletonRows } from '../ui';
import { useEvent } from './EventLayout';

/**
 * People › Print roll sheet: a paper backup for when phones, lanyards or
 * signal fail. Tick by hand, then enter the ticks later with Find by name.
 */
export function RollSheet() {
  const { event } = useEvent();
  const { base: eventBase } = useEvent();
  const { data, error, loading, reload } = useApi<{ registrations: Registration[] }>(`/events/${event.id}/registrations`);
  const [title, setTitle] = useState('');
  const [who, setWho] = useState<'all' | 'youth' | 'adult'>('all');
  const [columns, setColumns] = useState('In, Out');
  const back = { to: `${eventBase}/people`, label: 'People' };

  const header = (
    <div className="no-print">
      <PageHeader
        title="Print roll sheet"
        back={back}
        summary="A paper backup. If phones, lanyards or signal fail, tick names by hand and enter them later with Find by name on the scanner."
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
      {header}
      <div className="sections">
        <div className="form no-print">
          <div className="field-pair">
            <Field id="rs-title" label="Heading" optional hint="For example, Saturday lunch">
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field id="rs-cols" label="Tick columns" hint="Separate with commas, up to six">
              <input className="input" value={columns} onChange={(e) => setColumns(e.target.value)} />
            </Field>
          </div>
          <fieldset className="field">
            <legend className="field-label">Who</legend>
            <div className="choices choices-inline">
              {(
                [
                  ['all', 'Everyone'],
                  ['youth', 'Youth only'],
                  ['adult', 'Leaders only'],
                ] as const
              ).map(([v, label]) => (
                <label key={v} className="choice">
                  <input type="radio" name="rs-who" checked={who === v} onChange={() => setWho(v)} />
                  <span className="choice-text">{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="roll-sheet">
          <p className="roll-title">
            <strong>{title || 'Roll sheet'}</strong> · {event.name} · printed {new Date().toLocaleDateString('en-AU')}. Contains personal information: keep it secure and shred
            after use.
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
