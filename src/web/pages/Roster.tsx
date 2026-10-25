import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { DietaryEntryInput } from '../../shared/schemas';
import { ApiFailure, api } from '../api';
import { Icon } from '../components/Icon';
import { ActionButton, Loading, LoadError, Notice, PageHeader, Skeleton, SkeletonList } from '../components/ui';
import { Menu } from '../components/Menu';
import { useToast } from '../components/Toast';
import { useTitle } from '../useTitle';
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

/** People: everyone on the event's roster. */
export function Roster() {
  useTitle('People');
  const { event, can } = useEvent();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ registrations: Registration[] }>(`/events/${event.id}/registrations`);
  const [query, setQuery] = useState('');
  const [section, setSection] = useState('');
  const [message, setMessage] = useState<{ tone: 'ok' | 'stop'; text: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const all = useMemo(() => data?.registrations ?? [], [data]);
  const sections = useMemo(() => [...new Set(all.map((r) => r.section))].sort(), [all]);
  const shown = all.filter((r) => {
    if (section && r.section !== section) return false;
    return matchesSearch(query, `${r.preferredName || r.firstName} ${r.lastName}`, r.firstName, r.memberNumber, r.shortCode, r.groupName);
  });
  const active = all.filter((r) => r.status === 'active');
  const withoutCard = active.filter((r) => !r.shortCode).length;

  async function remove(r: Registration, name: string) {
    if (!window.confirm(`Delete ${name} from ${event.name}? Their card, dietary details and scans are deleted too. This can't be undone. To keep the records, withdraw them instead (open their page).`)) return;
    try {
      await api(`/events/${event.id}/registrations/${r.id}`, { method: 'DELETE' });
      setMessage(null);
      toast(`Deleted ${name}.`);
      await reload();
    } catch (err) {
      setMessage({ tone: 'stop', text: err instanceof ApiFailure ? err.message : 'Something went wrong.' });
    }
  }

  if (loading && !data)
    return (
      <Loading label="Loading people">
        <div className="skeleton-actions">
          <Skeleton width="12rem" height="1rem" />
          <Skeleton width="9rem" height="48px" radius="var(--radius-control)" />
        </div>
        <Skeleton width="100%" height="48px" radius="var(--radius-control)" className="skeleton-gap" />
        <SkeletonList rows={6} />
      </Loading>
    );
  if (error) return <LoadError error={error} onRetry={reload} />;

  return (
    <>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <PageHeader
        title={<span className="visually-hidden">People</span>}
        sub={
          all.length > 0 && (
            <>
              {active.length} {active.length === 1 ? 'person' : 'people'}: {active.filter((r) => r.kind === 'youth').length} youth,{' '}
              {active.filter((r) => r.kind === 'adult').length} adults
              {all.length > active.length && `. ${all.length - active.length} withdrawn`}
            </>
          )
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
                can('roster.edit') && all.length > 0 && { label: deleting ? 'Stop deleting' : 'Delete people…', onSelect: () => setDeleting(!deleting), danger: !deleting },
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
          <div className="row filters">
            <div className="field">
              <label htmlFor="roster-q">Search</label>
              <input id="roster-q" className="input" type="search" placeholder="Name, number or card" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="roster-section">Section</label>
              <select id="roster-section" className="input" value={section} onChange={(e) => setSection(e.target.value)}>
                <option value="">All sections</option>
                {sections.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="section-row">
            <p className="field-hint flush" aria-live="polite">
              {shown.length !== all.length && `${shown.length} of ${all.length} people`}
            </p>
            {deleting && (
              <button className="btn-link" onClick={() => setDeleting(false)}>
                Stop deleting
              </button>
            )}
          </div>
          {shown.length === 0 && (
            <p className="field-hint">
              No one matches.{' '}
              <button
                className="btn-link"
                onClick={() => {
                  setQuery('');
                  setSection('');
                }}
              >
                Clear search
              </button>
            </p>
          )}
          <ul className="list people-roster">
            {shown.map((r) => {
              const name = `${r.preferredName || r.firstName} ${r.lastName}`;
              const allergy = r.dietary?.some((d) => d.category === 'allergy');
              return (
                <li key={r.id} className={r.status === 'withdrawn' ? 'is-muted' : undefined}>
                  <div className="list-row roster-row">
                    <Link to={r.id} className="roster-link">
                      <span className="list-main">
                        <strong>{name}</strong>
                        <span>
                          {r.groupName}
                          {r.groupName && ', '}
                          {r.kind === 'adult' ? r.position || 'Leader' : r.section}
                          {r.shortCode ? `, card ${r.shortCode}` : ', no card'}
                        </span>
                      </span>
                      <span className="list-side">
                        {r.status === 'withdrawn' && <span className="tag">Withdrawn</span>}
                        {event.features.photo && r.photoConsent === 'no' && <span className="tag tag-stop">No photos</span>}
                        {allergy && <span className="tag tag-stop">Allergy</span>}
                        {!deleting && <Icon name="chevron" />}
                      </span>
                    </Link>
                    {deleting && (
                      <ActionButton className="btn btn-danger btn-small" busyLabel="Deleting…" onAction={() => remove(r, name)}>
                        Delete<span className="visually-hidden"> {name}</span>
                      </ActionButton>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
