import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiFailure, api } from '../api';
import { Banner, Button, EmptyState, Icon, LoadError, Loading, PageHeader, SearchField, SkeletonRows, Toolbar, useToast } from '../ui';
import { matchesSearch } from '../../shared/search';
import { ROLE_LABEL } from '../../shared/roles';
import { useEvent } from './EventLayout';
import { csvCell } from '../../shared/csv';

interface ParticipantLink {
  registrationId: string;
  name: string;
  kind: 'youth' | 'adult';
  shortCode: string;
  link: string;
}

function downloadCsv(filename: string, rows: string[][]) {
  const text = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * People › Participant links: each person's own page (the same link as the QR
 * on their lanyard), where they book activities, join teams, and see the
 * programme and meal menus. Copy them or download them all to send by email.
 */
export function ParticipantLinks() {
  const { event, base } = useEvent();
  const toast = useToast();
  const [links, setLinks] = useState<ParticipantLink[] | null>(null);
  const [missing, setMissing] = useState(0);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const back = { to: `${base}/links`, label: 'Links' };

  const load = useCallback(async () => {
    try {
      const [res, roster] = await Promise.all([
        api<{ links: ParticipantLink[] }>(`/events/${event.id}/credentials/links`, { body: {} }),
        api<{ registrations: { status: string; shortCode: string | null }[] }>(`/events/${event.id}/registrations`),
      ]);
      setLinks(res.links);
      setMissing(roster.registrations.filter((r) => r.status === 'active' && !r.shortCode).length);
      setFailure(null);
    } catch (err) {
      setFailure(err instanceof ApiFailure ? err : new ApiFailure(0, 'offline', 'No connection.'));
    }
  }, [event.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const roles = useMemo(() => [...new Set((links ?? []).map((l) => l.kind))].sort(), [links]);
  const shown = (links ?? []).filter((l) => (!role || l.kind === role) && matchesSearch(query, l.name, l.shortCode));

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied`);
    } catch {
      toast("Couldn't copy. Select the link and copy it yourself.", { tone: 'error' });
    }
  }

  async function issueMissing() {
    try {
      const { issued } = await api<{ issued: number }>(`/events/${event.id}/credentials/issue`, { body: { mode: 'missing' } });
      toast(`Made ${issued} new link${issued === 1 ? '' : 's'}`);
      await load();
    } catch (err) {
      toast(err instanceof ApiFailure ? err.message : 'No connection. Try again.', { tone: 'error' });
    }
  }

  function download() {
    const slug = event.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    downloadCsv(`${slug}-participant-links.csv`, [['Name', 'Role', 'Lanyard code', 'Link'], ...shown.map((l) => [l.name, ROLE_LABEL[l.kind], l.shortCode, l.link])]);
  }

  const header = (
    <PageHeader
      title="Participant links"
      back={back}
      summary={links && links.length > 0 ? `${links.length} ${links.length === 1 ? 'person' : 'people'}${missing ? ` · ${missing} without a link` : ''}` : undefined}
      help="Each person's own page: they book activities, join teams, and see the programme and meal menus with ingredients. It's the same link as the QR on their lanyard."
      primary={
        links &&
        links.length > 0 && (
          <Button kind="primary" disabled={shown.length === 0} onClick={download}>
            <Icon name="download" />
            Download CSV ({shown.length})
          </Button>
        )
      }
      menu={
        links && links.length > 0
          ? [{ label: `Copy all ${shown.length} as text`, onSelect: () => void copy(shown.map((l) => `${l.name}: ${l.link}`).join('\n'), 'Links') }]
          : undefined
      }
      menuLabel="More link actions"
    />
  );

  if (failure)
    return (
      <>
        {header}
        <LoadError error={failure} onRetry={load} what="participant links" />
      </>
    );
  if (!links)
    return (
      <>
        {header}
        <Loading what="participant links">
          <SkeletonRows rows={8} />
        </Loading>
      </>
    );

  const filtered = Boolean(query || role);
  return (
    <>
      {header}
      <div className="sections plinks">
        <div className="banners">
          <Banner tone="warning">
            Send each link only to that person or their family <span className="meta">· anyone with it can book and cancel for them. A new lanyard makes a new link.</span>
          </Banner>
          {missing > 0 && (
            <Banner
              action={
                <Button small onAction={issueMissing}>
                  Make {missing} missing link{missing === 1 ? '' : 's'}
                </Button>
              }
            >
              {missing} {missing === 1 ? 'person has' : 'people have'} no link yet <span className="meta">· links come with lanyards; print those later</span>
            </Banner>
          )}
        </div>
        {links.length === 0 ? (
          <EmptyState title="No links yet">Add people first, then make their links here.</EmptyState>
        ) : (
          <section className="section" aria-label="Links">
            <Toolbar sticky label="Find links">
              <SearchField id="links-q" label="Search" placeholder="Name or code" value={query} onChange={setQuery} slash />
              {roles.length > 1 && (
                <select className="select" aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="">Everyone</option>
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              )}
              {filtered && (
                <Button
                  small
                  kind="ghost"
                  onClick={() => {
                    setQuery('');
                    setRole('');
                  }}
                >
                  Clear
                </Button>
              )}
              <div className="toolbar-end">
                <span className="meta" aria-live="polite">
                  {shown.length === links.length ? `${links.length} links` : `${shown.length} of ${links.length}`}
                </span>
              </div>
            </Toolbar>
            {shown.length === 0 ? (
              <EmptyState title="No one matches">Try another name.</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="table links-table">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Role</th>
                      <th scope="col">Link</th>
                      <th scope="col">
                        <span className="visually-hidden">Copy</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((l) => (
                      <tr key={l.registrationId}>
                        <td>
                          <strong>{l.name}</strong>
                          <div className="meta num">{l.shortCode}</div>
                        </td>
                        <td>{ROLE_LABEL[l.kind]}</td>
                        <td className="link-cell">
                          <input className="input input-link" readOnly value={l.link} aria-label={`Link for ${l.name}`} onFocus={(e) => e.target.select()} />
                        </td>
                        <td>
                          <Button small onAction={() => copy(l.link, `Link for ${l.name}`)}>
                            <Icon name="copy" />
                            Copy<span className="visually-hidden"> link for {l.name}</span>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </>
  );
}
