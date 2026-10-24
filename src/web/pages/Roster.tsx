import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { DietaryEntryInput } from '../../shared/schemas';
import { ApiFailure, api } from '../api';
import { describeEntry } from '../components/DietaryEditor';
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

  const all = useMemo(() => data?.registrations ?? [], [data]);
  const sections = useMemo(() => [...new Set(all.map((r) => r.section))].sort(), [all]);
  const shown = all.filter((r) => {
    if (section && r.section !== section) return false;
    return matchesSearch(query, `${r.preferredName || r.firstName} ${r.lastName}`, r.firstName, r.memberNumber, r.shortCode, r.groupName);
  });
  const active = all.filter((r) => r.status === 'active');
  const withoutCard = active.filter((r) => !r.shortCode).length;

  async function replaceCard(r: Registration) {
    if (!window.confirm(`Replace ${r.displayName}'s lanyard? Their current card stops working immediately.`)) return;
    try {
      await api(`/events/${event.id}/credentials/issue`, { body: { mode: 'replace', registrationIds: [r.id] } });
      setMessage({ tone: 'ok', text: `New card issued for ${r.displayName}. Print it from Lanyards.` });
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
          {active.length} people: {active.filter((r) => r.kind === 'youth').length} youth, {active.filter((r) => r.kind === 'adult').length}{' '}
          adults
          {all.length > active.length && `. ${all.length - active.length} withdrawn`}
        </p>
        <div className="actions flush">
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
            <Link className="btn" to="../lanyards">
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
          <p className="lede">Import the participant export from MyScout to add youth and leaders.</p>
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
          <div className="sheet-wrap">
            <table className="sheet sheet-stack">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Group</th>
                  <th scope="col">Card</th>
                  {event.features.photo && all[0]?.photoConsent !== undefined && <th scope="col">Photos</th>}
                  {all[0]?.dietary !== undefined && <th scope="col">Dietary</th>}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className={r.status === 'withdrawn' ? 'is-muted' : undefined}>
                    <td>
                      <strong>
                        {r.preferredName || r.firstName} {r.lastName}
                      </strong>
                      <div className="field-hint">
                        {r.memberNumber}, {r.kind === 'adult' ? r.position || 'Adult' : r.section}
                        {r.status === 'withdrawn' && ', withdrawn'}
                      </div>
                    </td>
                    <td className="cell-plain">{r.groupName}</td>
                    <td data-label="Card" className="cell-inline">
                      {r.shortCode ?? <span className="field-hint">Not issued</span>}
                      {r.shortCode && can('credentials.manage') && r.status === 'active' && (
                        <button className="btn-link field-hint cell-action" onClick={() => void replaceCard(r)}>
                          Replace<span className="visually-hidden"> card for {r.displayName}</span>
                        </button>
                      )}
                    </td>
                    {event.features.photo && r.photoConsent !== undefined && (
                      <td className={r.photoConsent === 'yes' ? 'cell-plain hide-narrow' : 'cell-plain'}>
                        {r.photoConsent === 'yes' ? 'Photos OK' : <strong className="text-stop">{r.photoConsent === 'no' ? 'No photos' : 'Photo consent not recorded'}</strong>}
                      </td>
                    )}
                    {r.dietary !== undefined && (
                      <td className="cell-plain">
                        {r.dietary.map((d, i) => (
                          <div key={i} className={d.category === 'allergy' ? 'text-stop' : undefined}>
                            {describeEntry(d)}
                          </div>
                        ))}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
