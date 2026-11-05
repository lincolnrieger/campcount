import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { DietaryEntryInput } from '../../shared/schemas';
import { ApiFailure, api } from '../api';
import { ActionButton, Loading, LoadError, Notice, PageHeader, Skeleton, SkeletonTable } from '../components/ui';
import { SortHeader, sortRows, useSort } from '../components/Table';
import { Menu } from '../components/Menu';
import { useToast } from '../components/Toast';
import { useTitle } from '../shell';
import { useApi } from '../useApi';
import { useEvent } from './EventLayout';
import { matchesSearch } from '../../shared/search';

export interface Registration {
  id: string;
  memberNumber: string;
  firstName: string;
  preferredName: string;
  lastName: string;
  displayName: string;
  kind: 'youth' | 'adult';
  section: string;
  groupName: string;
  position: string;
  status: 'active' | 'withdrawn';
  shortCode: string | null;
  photoConsent?: 'yes' | 'no' | 'unknown';
  dietary?: DietaryEntryInput[];
  dietaryFingerprint?: string | null;
}

type Status = 'active' | 'withdrawn' | 'all';
type Column = 'name' | 'group' | 'section' | 'card';

const fullName = (r: Registration) => `${r.preferredName || r.firstName} ${r.lastName}`;
const roleOf = (r: Registration) => (r.kind === 'adult' ? r.position || 'Leader' : r.section);

/** People: everyone on the event's roster, as a sortable, filterable table. */
export function Roster() {
  useTitle('People');
  const { event, can } = useEvent();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ registrations: Registration[] }>(`/events/${event.id}/registrations`);
  const [query, setQuery] = useState('');
  const [section, setSection] = useState('');
  const [status, setStatus] = useState<Status>('active');
  const [message, setMessage] = useState<{ tone: 'ok' | 'stop'; text: string } | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const { sort, toggle } = useSort<Column>('name');

  const all = useMemo(() => data?.registrations ?? [], [data]);
  const sections = useMemo(() => [...new Set(all.map((r) => (r.kind === 'adult' ? 'Leaders' : r.section)))].sort(), [all]);
  const filtered = all.filter((r) => {
    if (status !== 'all' && r.status !== status) return false;
    if (section && (r.kind === 'adult' ? 'Leaders' : r.section) !== section) return false;
    return matchesSearch(query, fullName(r), r.firstName, r.memberNumber, r.shortCode, r.groupName);
  });
  const shown = sortRows(
    filtered,
    (r) => (sort.key === 'name' ? `${r.lastName} ${r.preferredName || r.firstName}` : sort.key === 'group' ? r.groupName : sort.key === 'card' ? r.shortCode : roleOf(r)),
    sort.dir,
  );
  const active = all.filter((r) => r.status === 'active');
  const withdrawn = all.length - active.length;
  const withoutCard = active.filter((r) => !r.shortCode).length;
  const filteredOut = shown.length !== all.filter((r) => status === 'all' || r.status === status).length;

  async function deleteSelected() {
    const people = all.filter((r) => selected.has(r.id));
    const n = people.length;
    if (
      !window.confirm(
        `Delete ${n === 1 ? fullName(people[0]!) : `${n} people`} from ${event.name}? Their cards, dietary details and scans are deleted too. This can't be undone. To keep the records, withdraw people instead (open their page).`,
      )
    )
      return;
    setBusy(true);
    let done = 0;
    try {
      for (const r of people) {
        await api(`/events/${event.id}/registrations/${r.id}`, { method: 'DELETE' });
        done++;
      }
      setMessage(null);
      toast(n === 1 ? `Deleted ${fullName(people[0]!)}.` : `Deleted ${n} people.`);
      setSelected(new Set());
      setSelecting(false);
    } catch (err) {
      setMessage({ tone: 'stop', text: `${done ? `Deleted ${done} of ${n}. ` : ''}${err instanceof ApiFailure ? err.message : 'Something went wrong.'}` });
    } finally {
      setBusy(false);
      await reload();
    }
  }

  if (loading && !data)
    return (
      <Loading label="Loading people">
        <div className="skeleton-actions">
          <Skeleton width="12rem" height="1rem" />
          <Skeleton width="7rem" height="var(--control)" radius="var(--radius-control)" />
        </div>
        <Skeleton width="100%" height="var(--control)" radius="var(--radius-control)" className="skeleton-gap" />
        <SkeletonTable rows={8} cols={4} />
      </Loading>
    );
  if (error) return <LoadError error={error} onRetry={reload} />;

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.id));

  return (
    <>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <PageHeader
        title="People"
        titleOn="desktop"
        sub={
          all.length > 0 &&
          `${active.length} ${active.length === 1 ? 'person' : 'people'}: ${active.filter((r) => r.kind === 'youth').length} youth, ${active.filter((r) => r.kind === 'adult').length} adults${withdrawn ? `. ${withdrawn} withdrawn` : ''}`
        }
        actions={
          <>
            {can('roster.edit') && (
              <Link className="btn" to="add">
                Add person
              </Link>
            )}
            <Menu
              label="More people actions"
              items={[
                can('roster.import') && { label: 'Import from MyScout', to: 'import' },
                can('credentials.manage') && active.length > 0 && { label: withoutCard > 0 ? `Print lanyards (${withoutCard} new)` : 'Print lanyards', to: 'lanyards' },
                active.length > 0 && { label: 'Print roll sheet', to: 'roll-sheet' },
                can('roster.edit') && all.length > 0 && !selecting && { label: 'Select people to delete…', onSelect: () => setSelecting(true), danger: true },
              ]}
            />
          </>
        }
      />

      {all.length === 0 ? (
        <div className="empty">
          <p>
            <strong>No one on the roster yet.</strong>
          </p>
          <p className="lede">Import the MyScout participant export, or add people one at a time.</p>
          <div className="actions">
            {can('roster.import') && (
              <Link className="btn" to="import">
                Import from MyScout
              </Link>
            )}
            {can('roster.edit') && (
              <Link className="btn btn-secondary" to="add">
                Add person
              </Link>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="toolbar">
            <input
              className="input input-search toolbar-search"
              type="search"
              aria-label="Search people"
              placeholder="Search name, member number or card"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select className="input" aria-label="Section" value={section} onChange={(e) => setSection(e.target.value)}>
              <option value="">All sections</option>
              {sections.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            {withdrawn > 0 && (
              <select className="input" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
                <option value="active">On the event</option>
                <option value="withdrawn">Withdrawn</option>
                <option value="all">Everyone</option>
              </select>
            )}
            <p className="toolbar-count" aria-live="polite">
              {filteredOut ? `${shown.length} of ${all.length}` : `${shown.length} shown`}
            </p>
          </div>

          {selecting && (
            <div className="toolbar panel-bar">
              <strong>{selected.size} selected</strong>
              <ActionButton className="btn btn-danger btn-small" disabled={selected.size === 0 || busy} busyLabel="Deleting…" onAction={deleteSelected}>
                Delete selected
              </ActionButton>
              <button
                className="btn btn-secondary btn-small"
                onClick={() => {
                  setSelecting(false);
                  setSelected(new Set());
                }}
              >
                Cancel
              </button>
            </div>
          )}

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {selecting && (
                    <th scope="col" className="col-check">
                      <input
                        type="checkbox"
                        className="check-input"
                        aria-label="Select all shown"
                        checked={allShownSelected}
                        onChange={() => setSelected(allShownSelected ? new Set() : new Set(shown.map((r) => r.id)))}
                      />
                    </th>
                  )}
                  <SortHeader label="Name" column="name" sort={sort} onSort={toggle} />
                  <SortHeader label="Group" column="group" sort={sort} onSort={toggle} className="hide-sm" />
                  <SortHeader label="Section or role" column="section" sort={sort} onSort={toggle} className="hide-sm" />
                  <SortHeader label="Card" column="card" sort={sort} onSort={toggle} className="hide-md" />
                  <th scope="col">
                    <span className="hide-sm">Notes</span>
                    <span className="visually-hidden show-sm">Notes</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const name = fullName(r);
                  const allergy = r.dietary?.some((d) => d.category === 'allergy');
                  return (
                    <tr key={r.id} className={[r.status === 'withdrawn' ? 'is-muted' : '', selected.has(r.id) ? 'is-selected' : ''].join(' ').trim() || undefined}>
                      {selecting && (
                        <td className="col-check col-actions">
                          <input type="checkbox" className="check-input" aria-label={`Select ${name}`} checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} />
                        </td>
                      )}
                      <td>
                        {selecting ? (
                          <strong>{name}</strong>
                        ) : (
                          <Link to={r.id} className="row-link">
                            {name}
                          </Link>
                        )}
                        <span className="cell-sub show-sm">
                          {[r.groupName, roleOf(r)].filter(Boolean).join(', ')}
                        </span>
                      </td>
                      <td className="hide-sm">{r.groupName}</td>
                      <td className="hide-sm">{roleOf(r)}</td>
                      <td className="hide-md mono meta">{r.shortCode ?? 'None'}</td>
                      <td>
                        <span className="cell-flags">
                          {r.status === 'withdrawn' && <span className="tag">Withdrawn</span>}
                          {event.features.photo && r.photoConsent === 'no' && <span className="tag tag-stop">No photos</span>}
                          {allergy && <span className="tag tag-stop">Allergy</span>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {shown.length === 0 && (
              <div className="empty">
                <p className="flush">
                  No one matches.{' '}
                  <button
                    className="btn-link"
                    onClick={() => {
                      setQuery('');
                      setSection('');
                      setStatus('all');
                    }}
                  >
                    Clear filters
                  </button>
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
