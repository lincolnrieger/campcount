import { useState } from 'react';
import { csvCell } from '../../shared/csv';
import { dayInZone, dayLabel, timeRange } from '../../shared/time';
import { api } from '../api';
import { useApi } from '../useApi';
import { Button, EmptyState, Icon, LoadError, Loading, Notice, PageHeader, useConfirm, useToast } from '../ui';
import { useEvent } from './EventLayout';

interface Links {
  code: string;
  selfSignup: boolean;
  sessions: { id: string; name: string; location: string; startsAt: string | null; endsAt: string | null }[];
}

/** Activities › Booking links: one link per activity, for an email before camp. */
export function BookingLinks() {
  const { event, base } = useEvent();
  const { data, error, loading, reload } = useApi<Links>(`/events/${event.id}/signup/links`);
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const header = (
    <PageHeader
      title="Booking links"
      back={{ to: `${base}/activities`, label: 'Activities' }}
      summary="One link per activity, to put in an email before camp. People open it, type their membership number and they’re booked. The page never shows who a number belongs to."
    />
  );
  if (loading && !data) return (<>{header}<Loading what="the links" rows={4} /></>);
  if (error || !data) return (<>{header}<LoadError error={error!} onRetry={reload} what="the links" /></>);

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

  return (
    <>
      {header}
      <div className="sections">
        {!data.selfSignup && (
          <Notice tone="warning">
            <p>Activity sign-up is switched off for this camp, so the links say booking is closed. Turn it on in Settings › Event details.</p>
          </Notice>
        )}
        {data.sessions.length === 0 ? (
          <EmptyState title="No activities open for sign-up">Open an activity for sign-up (on its page) and its link shows here.</EmptyState>
        ) : (
          <>
            <div className="btn-row">
              <Button onClick={download}>
                <Icon name="download" /> Download all links
              </Button>
              <Button
                kind="ghost"
                busy={busy}
                busyLabel="Making…"
                onClick={async () => {
                  if (!(await confirm({ title: 'Make new links?', body: <p>The links you’ve already sent stop working.</p>, confirm: 'Make new links', danger: true }))) return;
                  setBusy(true);
                  try {
                    await api(`/events/${event.id}/signup/links/new`, { body: {} });
                    await reload();
                    toast('New links made');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Make new links
              </Button>
            </div>
            <ul className="list">
              {data.sessions.map((s) => (
                <li key={s.id} className="row">
                  <span className="row-main">
                    <span className="row-title">{s.name}</span>
                    <span className="row-meta">{[when(s), s.location].filter(Boolean).join(' · ')}</span>
                    <span className="row-meta booking-link">{link(s.id)}</span>
                  </span>
                  <span className="row-side">
                    <Button small onClick={() => void copy(link(s.id))}>
                      <Icon name="copy" /> Copy
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
