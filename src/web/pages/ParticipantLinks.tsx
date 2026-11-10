import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiFailure, api } from '../api';
import { Button, EmptyState, Icon, LoadError, Loading, Notice, PageHeader, SearchField, SkeletonRows, useToast } from '../ui';
import { matchesSearch } from '../../shared/search';
import { useEvent } from './EventLayout';

interface ParticipantLink {
  registrationId: string;
  name: string;
  kind: 'youth' | 'adult';
  section: string;
  groupName: string;
  shortCode: string;
  link: string;
}

function downloadCsv(filename: string, rows: string[][]) {
  const text = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\r\n');
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
  const [group, setGroup] = useState('');
  const back = { to: `${base}/people`, label: 'People' };

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

  const groups = useMemo(() => [...new Set((links ?? []).map((l) => l.groupName))].filter(Boolean).sort(), [links]);
  const shown = (links ?? []).filter((l) => (!group || l.groupName === group) && matchesSearch(query, l.name, l.groupName, l.shortCode));

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
    const slug = event.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    downloadCsv(`${slug}-participant-links.csv`, [
      ['Name', 'Group', 'Section', 'Youth or adult', 'Lanyard code', 'Link'],
      ...shown.map((l) => [l.name, l.groupName, l.section, l.kind === 'adult' ? 'Adult' : 'Youth', l.shortCode, l.link]),
    ]);
  }

  const header = (
    <PageHeader
      title="Participant links"
      back={back}
      summary="Each person's own page: they book activities, join teams, and see the programme and meal menus with ingredients. It's the same link as the QR on their lanyard."
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
          ? [{ label: `Copy all ${shown.length} as text`, onSelect: () => void copy(shown.map((l) => `${l.name}${l.groupName ? ` (${l.groupName})` : ''}: ${l.link}`).join('\n'), 'Links') }]
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

  return (
    <>
      {header}
      <div className="sections">
        <Notice tone="warning" title="Send each link only to that person or their family">
          <p>Anyone with a link can book and cancel activities for that person. Replacing someone's lanyard makes a new link and stops the old one.</p>
        </Notice>
        {missing > 0 && (
          <Notice title={`${missing} ${missing === 1 ? 'person has' : 'people have'} no link yet`}>
            <p>Links come with lanyards. Make them now; you can print the lanyards later.</p>
            <Button onAction={issueMissing}>Make {missing} missing link{missing === 1 ? '' : 's'}</Button>
          </Notice>
        )}
        {links.length === 0 ? (
          <EmptyState title="No links yet">Add people first, then make their links here.</EmptyState>
        ) : (
          <>
            <div className="toolbar">
              <SearchField id="links-q" label="Search" placeholder="Name, group or code" value={query} onChange={setQuery} />
              {groups.length > 1 && (
                <select className="select" aria-label="Group" value={group} onChange={(e) => setGroup(e.target.value)}>
                  <option value="">All groups</option>
                  {groups.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {shown.length === 0 ? (
              <EmptyState title="No one matches">Try another name or group.</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="table links-table">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Group</th>
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
                        <td>{l.groupName}</td>
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
          </>
        )}
      </div>
    </>
  );
}
