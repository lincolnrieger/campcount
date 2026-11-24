import { useState } from 'react';
import { csvCell } from '../../shared/csv';
import { matchesSearch } from '../../shared/search';
import { dayInZone, dayLabel, timeRange } from '../../shared/time';
import { api } from '../api';
import { useApi } from '../useApi';
import { Banner, Button, ButtonLink, EmptyState, Icon, LoadError, Loading, PageHeader, SearchField, Toolbar, plural, useConfirm, useToast, useWide } from '../ui';
import { useEvent } from './EventLayout';

interface Links {
  code: string;
  selfSignup: boolean;
  sessions: { id: string; name: string; location: string; startsAt: string | null; endsAt: string | null }[];
}

/** Activities › Booking links: one link per activity, for an email before camp. */
export function BookingLinks() {
  const { event, base, can } = useEvent();
  const { data, error, loading, reload } = useApi<Links>(`/events/${event.id}/signup/links`);
  const toast = useToast();
  const confirm = useConfirm();
  const wide = useWide();
  const [q, setQ] = useState('');

  const makeNew = async () => {
    if (!(await confirm({ title: 'Make new links?', body: <p>The links you’ve already sent stop working.</p>, confirm: 'Make new links', danger: true }))) return;
    await api(`/events/${event.id}/signup/links/new`, { body: {} });
    await reload();
    toast('New links made');
  };

  const header = (
    <PageHeader
      title="Booking links"
      back={{ to: `${base}/links`, label: 'Links' }}
      summary={data && data.sessions.length > 0 ? plural(data.sessions.length, 'link') : undefined}
      help="One link per activity, to put in an email before camp. People open it, type their participant ID and they’re booked. The page never shows who a number belongs to."
      menu={data && data.sessions.length > 0 ? [{ label: 'Make new links…', danger: true, onSelect: () => void makeNew().catch(() => toast('No connection. Check your signal and try again.', { tone: 'error' })) }] : undefined}
    />
  );
  if (loading && !data)
    return (
      <>
        {header}
        <Loading what="the links" rows={4} />
      </>
    );
  if (error || !data)
    return (
      <>
        {header}
        <LoadError error={error!} onRetry={reload} what="the links" />
      </>
    );

  const link = (id: string) => `${window.location.origin}/book/${data.code}/${id}`;
  const when = (s: Links['sessions'][number]) => (s.startsAt ? `${dayLabel(dayInZone(s.startsAt, event.timezone))}, ${timeRange(s.startsAt, s.endsAt, event.timezone)}` : 'Any time');
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast('Link copied');
  };
  const download = () => {
    const rows = [['Activity', 'When', 'Where', 'Link'], ...data.sessions.map((s) => [s.name, when(s), s.location, link(s.id)])];
    const url = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Booking links.csv';
    a.click();
    URL.revokeObjectURL(url);
  };
  const shown = data.sessions.filter((s) => matchesSearch(q, s.name, s.location));
  const copyButton = (s: Links['sessions'][number]) => (
    <Button small onClick={() => void copy(link(s.id))}>
      <Icon name="copy" size={18} /> Copy<span className="visually-hidden"> link for {s.name}</span>
    </Button>
  );

  return (
    <>
      {header}
      <div className="sections pg-sections">
        {!data.selfSignup && (
          <Banner tone="warning" action={can('event.configure') && <ButtonLink small to={`${base}/settings/event`}>Settings</ButtonLink>}>
            Activity sign-up is off, so the links say booking is closed.
          </Banner>
        )}
        {data.sessions.length === 0 ? (
          <EmptyState title="No activities open for sign-up">Open an activity for sign-up (on its page) and its link shows here.</EmptyState>
        ) : (
          <>
            <Toolbar sticky label="Booking links">
              <SearchField id="links-q" label="Find an activity" value={q} onChange={setQ} slash />
              <div className="toolbar-end">
                <Button onClick={download}>
                  <Icon name="download" /> Download all (CSV)
                </Button>
              </div>
            </Toolbar>
            {shown.length === 0 ? (
              <EmptyState title={`No activities match "${q}"`} actions={<Button onClick={() => setQ('')}>Clear search</Button>} />
            ) : wide ? (
              <div className="table-wrap">
                <table className="table pg-table">
                  <thead>
                    <tr>
                      <th scope="col">Activity</th>
                      <th scope="col">When</th>
                      <th scope="col">Place</th>
                      <th scope="col">Link</th>
                      <th scope="col">
                        <span className="visually-hidden">Copy</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <strong>{s.name}</strong>
                        </td>
                        <td className="pg-nowrap">{when(s)}</td>
                        <td className="meta">{s.location}</td>
                        <td className="pg-link-cell">
                          <span className="booking-link meta" title={link(s.id)}>
                            {link(s.id)}
                          </span>
                        </td>
                        <td className="cell-action">{copyButton(s)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <ul className="list">
                {shown.map((s) => (
                  <li key={s.id} className="row">
                    <span className="row-main">
                      <span className="row-title">{s.name}</span>
                      <span className="row-meta">{[when(s), s.location].filter(Boolean).join(' · ')}</span>
                      <span className="row-meta booking-link">{link(s.id)}</span>
                    </span>
                    <span className="row-side">{copyButton(s)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </>
  );
}
