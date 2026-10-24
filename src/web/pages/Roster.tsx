import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { DietaryEntryInput } from '../../shared/schemas';
import { ApiFailure, api } from '../api';
import { Icon } from '../components/Icon';
import { Loading, Notice } from '../components/ui';
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

export function Roster() {
  const { event, can } = useEvent();
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
      setMessage({ tone: 'ok', text: `Deleted ${name}.` });
      await reload();
    } catch (err) {
      setMessage({ tone: 'stop', text: err instanceof ApiFailure ? err.message : 'Something went wrong.' });
    }
  }

  if (loading && !data) return <Loading />;
  if (error) return <Notice tone="stop">{error.message}</Notice>;

  return (
    <>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="page-head">
        <p className="lede flush">
          {active.length} {active.length === 1 ? 'person' : 'people'}: {active.filter((r) => r.kind === 'youth').length} youth, {active.filter((r) => r.kind === 'adult').length}{' '}
          adults
          {all.length > active.length && `. ${all.length - active.length} withdrawn`}
        </p>
        <div className="actions flush">
          {can('roster.edit') && (
            <Link className="btn" to="add">
              Add person
            </Link>
          )}
          {can('roster.import') && (
            <Link className="btn btn-secondary" to="../import">
              Import roster
            </Link>
          )}
          {active.length > 0 && (
            <Link className="btn btn-secondary" to="../roll-sheet">
              Paper roll sheet
            </Link>
          )}
          {can('credentials.manage') && active.length > 0 && (
            <Link className="btn btn-secondary" to="../lanyards">
              Lanyards{withoutCard > 0 && ` (${withoutCard} to print)`}
            </Link>
          )}
        </div>
      </div>

      {all.length === 0 ? (
        <div className="empty">
          <p>
            <strong>No one on the roster yet.</strong>
          </p>
          <p className="lede">Import the MyScout participant export, or add people one at a time with Add person.</p>
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
            <p className="field-hint flush">
              {shown.length === all.length ? `${all.length} ${all.length === 1 ? 'person' : 'people'}` : `${shown.length} of ${all.length} people`}
            </p>
            {can('roster.edit') && (
              <button className="btn-link" onClick={() => setDeleting(!deleting)}>
                {deleting ? 'Done' : 'Delete people'}
              </button>
            )}
          </div>
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
                      <button className="btn btn-danger btn-small" onClick={() => void remove(r, name)}>
                        Delete<span className="visually-hidden"> {name}</span>
                      </button>
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
