import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ApiFailure, api } from '../api';
import type { Registration } from '../model';
import { useApi } from '../useApi';
import { matchesSearch } from '../../shared/search';
import {
  Badge,
  Button,
  ButtonLink,
  EmptyState,
  LoadError,
  Loading,
  PageHeader,
  SearchField,
  SkeletonRows,
  SortHeader,
  sortRows,
  useConfirm,
  useSort,
  useToast,
  useWide,
} from '../ui';
import { useEvent } from './EventLayout';

type Filter = 'all' | 'youth' | 'adult' | 'nocard' | 'withdrawn';
type Column = 'name' | 'group' | 'section' | 'card';

const fullName = (r: Registration) => `${r.preferredName || r.firstName} ${r.lastName}`;
const roleOf = (r: Registration) => (r.kind === 'adult' ? r.position || 'Leader' : r.section);

/** People: everyone on the event, searchable and sortable. */
export function Roster() {
  const { event, can } = useEvent();
  const toast = useToast();
  const confirm = useConfirm();
  const wide = useWide();
  const { data, error, loading, reload } = useApi<{ registrations: Registration[] }>(`/events/${event.id}/registrations`);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { sort, toggle } = useSort<Column>('name');

  const all = useMemo(() => data?.registrations ?? [], [data]);
  const active = all.filter((r) => r.status === 'active');
  const withoutCard = active.filter((r) => !r.shortCode).length;
  const filtered = all.filter((r) => {
    if (filter === 'withdrawn' ? r.status !== 'withdrawn' : r.status !== 'active') return false;
    if (filter === 'youth' && r.kind !== 'youth') return false;
    if (filter === 'adult' && r.kind !== 'adult') return false;
    if (filter === 'nocard' && r.shortCode) return false;
    return matchesSearch(query, fullName(r), r.firstName, r.memberNumber, r.shortCode, r.groupName);
  });
  const shown = sortRows(
    filtered,
    (r) => (sort.key === 'name' ? `${r.lastName} ${r.preferredName || r.firstName}` : sort.key === 'group' ? r.groupName : sort.key === 'card' ? r.shortCode : roleOf(r)),
    sort.dir,
  );

  async function deleteSelected() {
    const people = all.filter((r) => selected.has(r.id));
    const n = people.length;
    const ok = await confirm({
      title: n === 1 ? `Delete ${fullName(people[0]!)}?` : `Delete ${n} people?`,
      body: <p>Their lanyards, dietary needs and scans are deleted too. This can't be undone. To keep the records, withdraw people instead from their page.</p>,
      confirm: n === 1 ? 'Delete person' : `Delete ${n} people`,
      danger: true,
    });
    if (!ok) return;
    let done = 0;
    try {
      for (const r of people) {
        await api(`/events/${event.id}/registrations/${r.id}`, { method: 'DELETE' });
        done++;
      }
      toast(n === 1 ? `Deleted ${fullName(people[0]!)}` : `Deleted ${n} people`);
      setSelected(new Set());
      setSelecting(false);
    } catch (err) {
      toast(`${done ? `Deleted ${done} of ${n}. ` : ''}${err instanceof ApiFailure ? err.message : 'No connection. Try again.'}`, { tone: 'error' });
    } finally {
      await reload();
    }
  }

  const header = (
    <PageHeader
      title="People"
      summary={
        all.length > 0 && (
          <span>
            {active.length} on the event: {active.filter((r) => r.kind === 'youth').length} youth, {active.filter((r) => r.kind === 'adult').length} leaders
          </span>
        )
      }
      primary={
        can('roster.edit') && (
          <ButtonLink to="add" kind="primary">
            Add person
          </ButtonLink>
        )
      }
      menu={[
        can('roster.import') && { label: 'Import from MyScout', to: 'import' },
        can('credentials.manage') && active.length > 0 && { label: withoutCard > 0 ? `Print lanyards (${withoutCard} new)` : 'Print lanyards', to: 'lanyards' },
        can('credentials.manage') && active.length > 0 && { label: 'Participant links', to: 'links' },
        active.length > 0 && { label: 'Print roll sheet', to: 'roll-sheet' },
        can('roster.edit') && all.length > 0 && !selecting && { label: 'Select people to delete…', onSelect: () => setSelecting(true), danger: true },
      ]}
      menuLabel="More people actions"
    />
  );

  if (loading && !data)
    return (
      <>
        {header}
        <Loading what="people">
          <SkeletonRows rows={8} />
        </Loading>
      </>
    );
  if (error)
    return (
      <>
        {header}
        <LoadError error={error} onRetry={reload} what="people" />
      </>
    );

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.id));

  const flags = (r: Registration) => (
    <>
      {r.status === 'withdrawn' && <Badge>Withdrawn</Badge>}
      {event.features.photo && r.photoConsent === 'no' && <Badge tone="error">No photos</Badge>}
      {r.dietary?.some((d) => d.category === 'allergy') && <Badge tone="error">Allergy</Badge>}
      {r.status === 'active' && !r.shortCode && <Badge tone="warning">No lanyard</Badge>}
    </>
  );

  return (
    <>
      {header}
      {all.length === 0 ? (
        <EmptyState
          title="No one on this event yet"
          actions={
            <>
              {can('roster.import') && (
                <ButtonLink to="import" kind="primary">
                  Import from MyScout
                </ButtonLink>
              )}
              {can('roster.edit') && <ButtonLink to="add">Add person</ButtonLink>}
            </>
          }
        >
          Import the MyScout participant export, or add people one at a time.
        </EmptyState>
      ) : (
        <div className="section">
          <div className="toolbar">
            <SearchField id="people-q" label="Search name, member number or lanyard code" value={query} onChange={setQuery} />
            <label htmlFor="people-filter" className="visually-hidden">
              Show
            </label>
            <select id="people-filter" className="select" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              <option value="all">Everyone</option>
              <option value="youth">Youth</option>
              <option value="adult">Leaders</option>
              <option value="nocard">No lanyard</option>
              <option value="withdrawn">Withdrawn</option>
            </select>
            <p className="toolbar-count" aria-live="polite">
              {shown.length} {shown.length === 1 ? 'person' : 'people'}
            </p>
          </div>

          {selecting && (
            <div className="panel panel-pad select-bar">
              <strong>{selected.size} selected</strong>
              <div className="btn-row">
                <Button kind="danger" small disabled={selected.size === 0} busyLabel="Deleting…" onAction={deleteSelected}>
                  Delete selected
                </Button>
                <Button
                  small
                  onClick={() => {
                    setSelecting(false);
                    setSelected(new Set());
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {shown.length === 0 ? (
            <EmptyState
              title="No one matches"
              actions={
                <Button
                  onClick={() => {
                    setQuery('');
                    setFilter('all');
                  }}
                >
                  Clear search and filter
                </Button>
              }
            />
          ) : wide ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    {selecting && (
                      <th scope="col" className="cell-check">
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
                    <SortHeader label="Section" column="section" sort={sort} onSort={toggle} />
                    <SortHeader label="Scout group" column="group" sort={sort} onSort={toggle} />
                    <SortHeader label="Lanyard" column="card" sort={sort} onSort={toggle} />
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const name = fullName(r);
                    return (
                      <tr key={r.id} className={selecting ? (selected.has(r.id) ? 'is-selected' : undefined) : 'row-link'}>
                        {selecting && (
                          <td className="cell-check">
                            <input type="checkbox" className="check-input" aria-label={`Select ${name}`} checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} />
                          </td>
                        )}
                        <td>
                          {selecting ? (
                            <strong>{name}</strong>
                          ) : (
                            <Link to={r.id} className="cell-link">
                              {name}
                            </Link>
                          )}
                        </td>
                        <td>{roleOf(r)}</td>
                        <td>{r.groupName}</td>
                        <td className="code-cell">{r.shortCode ?? '—'}</td>
                        <td>
                          <span className="badges">{flags(r)}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <ul className="list">
              {shown.map((r) => {
                const name = fullName(r);
                const meta = [roleOf(r), r.groupName].filter(Boolean).join(' · ');
                return selecting ? (
                  <li key={r.id}>
                    <label className={selected.has(r.id) ? 'row row-select is-highlight' : 'row row-select'}>
                      <input type="checkbox" className="check-input" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} />
                      <span className="row-main">
                        <span className="row-title">{name}</span>
                        <span className="row-meta">{meta}</span>
                      </span>
                    </label>
                  </li>
                ) : (
                  <li key={r.id} className={r.status === 'withdrawn' ? 'row row-link is-muted' : 'row row-link'}>
                    <span className="row-main">
                      <span className="row-title">
                        <Link to={r.id}>{name}</Link>
                      </span>
                      <span className="row-meta">{meta}</span>
                      <span className="badges">{flags(r)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
