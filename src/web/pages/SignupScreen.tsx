import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ApiFailure, api } from '../api';
import { QrCode } from '../components/QrCode';
import { placesLeft } from '../components/SignupPanel';
import type { SignupSession } from '../components/SignupPanel';
import { useApi } from '../useApi';
import { dayInZone, dayLabel, timeRange } from '../../shared/time';
import { Badge, Button, EmptyState, Icon, LoadError, Loading, Notice, PageHeader, Section, Skeleton, SkeletonRows, useConfirm, useToast } from '../ui';
import { useEvent } from './EventLayout';

interface SignupInfo {
  enabled: boolean;
  link: string;
  sessions: SignupSession[];
}

/** Activities › Sign-up kiosk and posters: the kiosk link for camp HQ, and a poster for each session people can book. */
export function SignupScreen() {
  const { event, can, base, reload: reloadEvent } = useEvent();
  const toast = useToast();
  const confirm = useConfirm();
  const manage = can('activities.manage');
  const signup = useApi<SignupInfo>(manage ? `/events/${event.id}/signup` : null);
  // Which posters to print: null means none chosen yet; printing waits for the render.
  const [printing, setPrinting] = useState<string[] | null>(null);
  const tz = event.timezone;
  const back = { to: `${base}/activities`, label: 'Activities' };

  useEffect(() => {
    if (!printing) return;
    const t = window.setTimeout(() => {
      window.print();
      setPrinting(null);
    }, 50);
    return () => window.clearTimeout(t);
  }, [printing]);

  const fail = (err: unknown) => toast(err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.', { tone: 'error' });

  if (!manage)
    return (
      <>
        <PageHeader title="Sign-up kiosk" back={back} />
        <Notice tone="warning">
          <p>Only event managers can set up the sign-up kiosk.</p>
        </Notice>
      </>
    );
  if (signup.loading && !signup.data)
    return (
      <Loading what="sign-up kiosk">
        <Skeleton className="skeleton-title" />
        <Skeleton width="100%" height="14rem" className="" />
        <SkeletonRows rows={3} />
      </Loading>
    );
  if (signup.error)
    return (
      <>
        <PageHeader title="Sign-up kiosk" back={back} />
        <LoadError error={signup.error} onRetry={signup.reload} what="the sign-up kiosk" />
      </>
    );
  const data = signup.data!;
  const sessions = data.sessions;
  const when = (s: SignupSession) => (s.startsAt ? `${dayLabel(dayInZone(s.startsAt, tz), 'long')}, ${timeRange(s.startsAt, s.endsAt, tz)}` : 'Any time');
  const toPrint = sessions.filter((s) => printing?.includes(s.id));

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="Sign-up kiosk"
          back={back}
          summary="People book activity sessions by scanning their lanyard at a tablet, or from a poster at the activity."
          menu={
            data.enabled
              ? [
                  {
                    label: 'Make a new link…',
                    danger: true,
                    onSelect: async () => {
                      const ok = await confirm({
                        title: 'Make a new link?',
                        body: <p>The current link, any open kiosk screens and every printed poster stop working. You'll need to reprint the posters.</p>,
                        confirm: 'Make a new link',
                        danger: true,
                      });
                      if (!ok) return;
                      try {
                        await api(`/events/${event.id}/signup/new-link`, { body: {} });
                        toast('New link made. Reprint the posters.');
                        await signup.reload();
                      } catch (err) {
                        fail(err);
                      }
                    },
                  },
                ]
              : undefined
          }
        />
        <div className="sections">
          {!data.enabled ? (
            <EmptyState
              title="Activity sign-up is switched off"
              actions={
                can('event.configure') && (
                  <Button
                    kind="primary"
                    busyLabel="Turning on…"
                    onAction={async () => {
                      try {
                        await api(`/events/${event.id}`, { method: 'PATCH', body: { features: { selfSignup: true } } });
                        await reloadEvent();
                        await signup.reload();
                        toast('Activity sign-up is on');
                      } catch (err) {
                        fail(err);
                      }
                    }}
                  >
                    Turn on activity sign-up
                  </Button>
                )
              }
            >
              Turn it on to let people book sessions themselves.
            </EmptyState>
          ) : (
            <>
              <Section title="Kiosk" id="kiosk">
                <div className="panel panel-pad kiosk-share">
                  <div className="kiosk-qr">
                    <QrCode value={data.link} size="100%" label="Sign-up kiosk QR code" />
                  </div>
                  <div className="stack">
                    <p>Open this on a tablet at camp HQ. People scan their lanyard, or type its code, and book. It goes back to the start after 90 seconds.</p>
                    <div className="field">
                      <label htmlFor="kiosk-link" className="field-label">
                        Kiosk link
                      </label>
                      <input id="kiosk-link" className="input" readOnly value={data.link} onFocus={(e) => e.target.select()} />
                    </div>
                    <div className="btn-row">
                      <a className="btn btn-primary" href={data.link} target="_blank" rel="noreferrer">
                        Open kiosk<span className="visually-hidden"> (opens in a new tab)</span>
                      </a>
                      <Button
                        onAction={async () => {
                          try {
                            await navigator.clipboard.writeText(data.link);
                            toast('Link copied');
                          } catch {
                            toast("Couldn't copy. Select the link and copy it yourself.", { tone: 'error' });
                          }
                        }}
                      >
                        <Icon name="copy" />
                        Copy link
                      </Button>
                    </div>
                  </div>
                </div>
              </Section>

              <Section
                title="Session posters"
                id="posters"
                actions={
                  sessions.length > 1 && (
                    <Button onClick={() => setPrinting(sessions.map((s) => s.id))}>
                      <Icon name="print" />
                      Print all
                    </Button>
                  )
                }
              >
                {sessions.length === 0 ? (
                  <EmptyState title="No sessions open for sign-up">
                    Open an activity on the <Link to={`${base}/activities`}>Activities</Link> tab, choose Edit activity, and tick "Open for self sign-up".
                  </EmptyState>
                ) : (
                  <>
                    <p className="meta">Put a poster at each activity. Scanning it opens the kiosk with that session chosen; people then scan their lanyard to book.</p>
                    <ul className="list">
                      {sessions.map((s) => (
                        <li key={s.id} className="row">
                          <span className="row-main">
                            <span className="row-title">{s.name}</span>
                            <span className="row-meta">{[when(s), s.location || null].filter(Boolean).join(' · ')}</span>
                          </span>
                          <Badge tone={s.full ? 'neutral' : 'success'}>{placesLeft(s)}</Badge>
                          <span className="row-side">
                            <Button small onClick={() => setPrinting([s.id])}>
                              Print<span className="visually-hidden"> poster for {s.name}</span>
                            </Button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </Section>
            </>
          )}
        </div>
      </div>

      {toPrint.length > 0 && (
        <div className="session-posters" aria-hidden="true">
          {toPrint.map((s) => (
            <article key={s.id} className="session-poster">
              <p className="session-poster-event">{event.name}</p>
              <h2>{s.name}</h2>
              <p className="session-poster-when">
                {when(s)}
                {s.location && <br />}
                {s.location}
              </p>
              <div className="session-poster-qr">
                <QrCode value={`${data.link}?activity=${s.id}`} size="100%" label={`Sign up for ${s.name}`} />
              </div>
              <p className="session-poster-cta">Scan to sign up, then scan your lanyard</p>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
