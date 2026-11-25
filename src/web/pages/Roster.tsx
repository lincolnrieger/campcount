import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ApiFailure, api } from '../api';
import { ROLE_LABEL } from '../../shared/roles';
import type { Registration } from '../model';
import { useApi } from '../useApi';
import { matchesSearch } from '../../shared/search';
import {
  Badge,
  Banner,
  Button,
  ButtonLink,
  EmptyState,
  FilterChips,
  LoadError,
  Loading,
  PageHeader,
  Popover,
  SearchField,
  SelectionBar,
  SkeletonRows,
  SortHeader,
  Toolbar,
  plural,
  sortRows,
  useConfirm,
  useRemembered,
  useToast,
  useWide,
} from '../ui';
import type { SortState } from '../ui';
import { useEvent } from './EventLayout';

type Filter = 'all' | 'youth' | 'adult' | 'nocard' | 'withdrawn';
type Column = 'name' | 'id' | 'role' | 'card';
const SORT_LABEL: Record<Column, string> = { name: 'Name', id: 'Participant ID', role: 'Role', card: 'Lanyard' };

const fullName = (r: Registration) => `${r.firstName} ${r.lastName}`.trim();
const roleOf = (r: Registration) => ROLE_LABEL[r.kind];

/** People: everyone on the event, searchable, filterable and sortable, with bulk actions on the selected. */
export function Roster() {
  const { event, can } = useEvent();
  const toast = useToast();
  const confirm = useConfirm();
  const wide = useWide();
  const { data, error, loading, reload } = useApi<{ registrations: Registration[] }>(`/events/${event.id}/registrations`);
  const [query, setQuery] = useRemembered(`people:${event.id}:q`, '');
  const [filter, setFilter] = useRemembered<Filter>(`people:${event.id}:filter`, 'all');
  const [sort, setSort] = useRemembered<SortState<Column>>(`people:${event.id}:sort`, { key: 'name', dir: 'asc' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSort = (k: Column) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' }));

  const canEdit = can('roster.edit');
  const canCards = can('credentials.manage');
  const canSelect = canEdit || canCards;

  const all = useMemo(() => data?.registrations ?? [], [data]);
  const active = all.filter((r) => r.status === 'active');
  const withdrawn = all.length - active.length;
  const withoutCard = active.filter((r) => !r.shortCode).length;

  // Everything except the chip filter, so the chips can show what each would give.
  const base = all.filter((r) => matchesSearch(query, fullName(r), r.firstName, r.participantId, r.shortCode));
  const inFilter = (r: Registration, f: Filter) => {
    if (f === 'withdrawn' ? r.status !== 'withdrawn' : r.status !== 'active') return false;
    if (f === 'youth' && r.kind !== 'youth') return false;
    if (f === 'adult' && r.kind !== 'adult') return false;
    if (f === 'nocard' && r.shortCode) return false;
    return true;
  };
  const count = (f: Filter) => base.filter((r) => inFilter(r, f)).length;
  const shown = sortRows(
    base.filter((r) => inFilter(r, filter)),
    (r) => (sort.key === 'name' ? `${r.lastName} ${r.firstName}` : sort.key === 'id' ? r.participantId : sort.key === 'card' ? r.shortCode : roleOf(r)),
    sort.dir,
  );
  const picked = all.filter((r) => selected.has(r.id));
  const pickedActive = picked.filter((r) => r.status === 'active');
  const pickedWithdrawn = picked.filter((r) => r.status === 'withdrawn');
  const pickedNoCard = pickedActive.filter((r) => !r.shortCode);

  const clearAll = () => {
    setQuery('');
    setFilter('all');
  };
  const failMessage = (err: unknown) => (err instanceof ApiFailure ? err.message : 'No connection. Try again.');

  async function deleteSelected() {
    const people = picked;
    const n = people.length;
    const ok = await confirm({
      title: n === 1 ? `Delete ${fullName(people[0]!)}?` : `Delete ${n} people?`,
      body: <p>Their lanyards and scans are deleted too. This can't be undone. To keep the records, withdraw instead.</p>,
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
    } catch (err) {
      toast(`${done ? `Deleted ${done} of ${n}. ` : ''}${failMessage(err)}`, { tone: 'error' });
    } finally {
      await reload();
    }
  }

  /** Withdraw or restore the selected, one at a time with the same call as their own page. */
  async function setStatusSelected(status: 'active' | 'withdrawn') {
    const people = status === 'withdrawn' ? pickedActive : pickedWithdrawn;
    const n = people.length;
    if (status === 'withdrawn') {
      const ok = await confirm({
        title: n === 1 ? `Withdraw ${fullName(people[0]!)}?` : `Withdraw ${n} people?`,
        body: <p>Their cards stop scanning. Their records are kept, and you can restore them later.</p>,
        confirm: n === 1 ? 'Withdraw' : `Withdraw ${n} people`,
      });
      if (!ok) return;
    }
    let done = 0;
    try {
      for (const r of people) {
        await api(`/events/${event.id}/registrations/${r.id}`, { method: 'PATCH', body: { status } });
        done++;
      }
      toast(status === 'withdrawn' ? `Withdrew ${plural(n, 'person', 'people')}` : `Restored ${plural(n, 'person', 'people')}`);
      setSelected(new Set());
    } catch (err) {
      toast(`${done ? `Done ${done} of ${n}. ` : ''}${failMessage(err)}`, { tone: 'error' });
    } finally {
      await reload();
    }
  }

  async function issueSelected() {
    try {
      const res = await api<{ issued: number }>(`/events/${event.id}/credentials/issue`, { body: { mode: 'missing', registrationIds: pickedNoCard.map((r) => r.id) } });
      toast(`Issued ${plural(res.issued, 'lanyard')}`);
      setSelected(new Set());
    } catch (err) {
      toast(failMessage(err), { tone: 'error' });
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
            {active.length} on the event · {active.filter((r) => r.kind === 'youth').length} participants · {active.filter((r) => r.kind === 'adult').length} leaders
          </span>
        )
      }
      help={canSelect ? 'Tick people to withdraw, restore, issue lanyards or delete them together. Press / to search.' : 'Press / to search.'}
      primary={
        canEdit && (
          <ButtonLink to="add" kind="primary">
            Add person
          </ButtonLink>
        )
      }
      // Lanyards, the leader roster, the roll sheet and links are in the navigation (People, Links & sign-up).
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
  const shownSelected = shown.filter((r) => selected.has(r.id)).length;
  const allShownSelected = shown.length > 0 && shownSelected === shown.length;
  const toggleShown = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of shown) {
        if (allShownSelected) next.delete(r.id);
        else next.add(r.id);
      }
      return next;
    });

  const flags = (r: Registration) => (
    <>
      {r.status === 'withdrawn' && <Badge>Withdrawn</Badge>}
      {r.status === 'active' && !r.shortCode && <Badge tone="warning">No lanyard</Badge>}
    </>
  );

  const sortMenu = (
    <Popover label="Sort" icon="layers" button="Sort" align="end">
      <div className="field">
        <label className="field-label" htmlFor="people-sort">
          Sort by
        </label>
        <select
          id="people-sort"
          className="select"
          value={`${sort.key}:${sort.dir}`}
          onChange={(e) => {
            const [key, dir] = e.target.value.split(':') as [Column, 'asc' | 'desc'];
            setSort({ key, dir });
          }}
        >
          {(Object.keys(SORT_LABEL) as Column[]).flatMap((k) => [
            <option key={`${k}:asc`} value={`${k}:asc`}>
              {SORT_LABEL[k]} (A–Z)
            </option>,
            <option key={`${k}:desc`} value={`${k}:desc`}>
              {SORT_LABEL[k]} (Z–A)
            </option>,
          ])}
        </select>
      </div>
    </Popover>
  );

  return (
    <>
      {header}
      {all.length === 0 ? (
        <EmptyState
          title="No one on this event yet"
          actions={
            <>
              {canEdit && (
                <ButtonLink to="add" kind="primary">
                  Add person
                </ButtonLink>
              )}
            </>
          }
        />
      ) : (
        <div className="section people-list">
          {canCards && withoutCard > 0 && (
            <Banner
              tone="warning"
              action={
                <ButtonLink to="lanyards/print" small>
                  Issue lanyards
                </ButtonLink>
              }
            >
              {withoutCard === 1 ? '1 person has no lanyard' : `${withoutCard} people have no lanyard`}
            </Banner>
          )}
          <Toolbar sticky label="Search and filter people">
            <SearchField id="people-q" label="Search name, participant ID or lanyard code" placeholder="Search people" value={query} onChange={setQuery} slash />
            {!wide && sortMenu}
            <div className="toolbar-end">
              <p className="toolbar-count" aria-live="polite">
                {plural(shown.length, 'person', 'people')}
              </p>
            </div>
            <FilterChips
              label="Show"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'Everyone', count: count('all') },
                { value: 'youth', label: 'Participants', count: count('youth') },
                { value: 'adult', label: 'Leaders', count: count('adult') },
                ...(withoutCard > 0 || filter === 'nocard' ? [{ value: 'nocard' as const, label: 'No lanyard', count: count('nocard') }] : []),
                ...(withdrawn > 0 || filter === 'withdrawn' ? [{ value: 'withdrawn' as const, label: 'Withdrawn', count: count('withdrawn') }] : []),
              ]}
            />
          </Toolbar>

          {shown.length === 0 ? (
            <EmptyState title="No one matches" actions={<Button onClick={clearAll}>Clear search and filters</Button>} />
          ) : wide ? (
            <div className="table-wrap scroll-list people-scroll">
              <table className="table people-table">
                <thead>
                  <tr>
                    {canSelect && (
                      <th scope="col" className="cell-check">
                        <input
                          type="checkbox"
                          className="check-input"
                          aria-label={`Select all ${shown.length} shown`}
                          checked={allShownSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = shownSelected > 0 && !allShownSelected;
                          }}
                          onChange={toggleShown}
                        />
                      </th>
                    )}
                    <SortHeader label="Name" column="name" sort={sort} onSort={toggleSort} />
                    <SortHeader label="Participant ID" column="id" sort={sort} onSort={toggleSort} />
                    <SortHeader label="Role" column="role" sort={sort} onSort={toggleSort} />
                    <SortHeader label="Lanyard" column="card" sort={sort} onSort={toggleSort} />
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const name = fullName(r);
                    const on = selected.has(r.id);
                    return (
                      <tr key={r.id} className={['row-link', on && 'is-selected', r.status === 'withdrawn' && 'is-muted'].filter(Boolean).join(' ')}>
                        {canSelect && (
                          <td className="cell-check">
                            <input type="checkbox" className="check-input" aria-label={`Select ${name}`} checked={on} onChange={() => toggleOne(r.id)} />
                          </td>
                        )}
                        <td>
                          <Link to={r.id} className="cell-link">
                            {name}
                          </Link>
                        </td>
                        <td className="code-cell">{r.participantId}</td>
                        <td>{roleOf(r)}</td>
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
            <>
              {canSelect && (
                <label className="people-select-all">
                  <input
                    type="checkbox"
                    className="check-input"
                    checked={allShownSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = shownSelected > 0 && !allShownSelected;
                    }}
                    onChange={toggleShown}
                  />
                  Select all {shown.length} shown
                </label>
              )}
              <ul className="list people-rows">
                {shown.map((r) => {
                  const name = fullName(r);
                  const meta = [roleOf(r), r.participantId].filter(Boolean).join(' · ');
                  const on = selected.has(r.id);
                  return (
                    <li key={r.id} className={['row row-link', r.status === 'withdrawn' && 'is-muted', on && 'is-highlight'].filter(Boolean).join(' ')}>
                      {canSelect && <input type="checkbox" className="check-input people-row-check" aria-label={`Select ${name}`} checked={on} onChange={() => toggleOne(r.id)} />}
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
            </>
          )}

          <SelectionBar count={selected.size} onClear={() => setSelected(new Set())}>
            {!allShownSelected && shown.length > shownSelected && (
              <Button small kind="ghost" className="selection-ghost" onClick={toggleShown}>
                Select all {shown.length} shown
              </Button>
            )}
            {canCards && pickedNoCard.length > 0 && (
              <Button small busyLabel="Issuing…" onAction={issueSelected}>
                Issue {plural(pickedNoCard.length, 'lanyard')}
              </Button>
            )}
            {canEdit && pickedActive.length > 0 && (
              <Button small busyLabel="Withdrawing…" onAction={() => setStatusSelected('withdrawn')}>
                Withdraw{pickedActive.length !== selected.size ? ` ${pickedActive.length}` : ''}
              </Button>
            )}
            {canEdit && pickedWithdrawn.length > 0 && (
              <Button small busyLabel="Restoring…" onAction={() => setStatusSelected('active')}>
                Restore{pickedWithdrawn.length !== selected.size ? ` ${pickedWithdrawn.length}` : ''}
              </Button>
            )}
            {canEdit && (
              <Button kind="danger" small busyLabel="Deleting…" onAction={deleteSelected}>
                Delete
              </Button>
            )}
          </SelectionBar>
        </div>
      )}
    </>
  );
}
