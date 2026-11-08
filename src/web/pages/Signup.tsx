import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { parseCredentialPayload } from '../../shared/credentials';
import { ApiFailure, api } from '../api';
import { SessionBoard, SignupPanel } from '../components/SignupPanel';
import { TeamsPanel } from '../components/TeamsPanel';
import type { ProgrammeItem, SignupSession, SignupView } from '../components/SignupPanel';
import { dayInZone, dayLabel, timeInZone } from '../../shared/time';
import { createDetector } from '../scan/decoder';
import { useTitle } from '../shell';
import { useSiteEvent } from '../site';
import { BrandMark } from '../ui/AppShell';
import { SiteLogo } from '../ui/SiteShell';
import { Badge, Button, Field, Icon, Loading, Notice, Segmented, SkeletonRows, formatDateRange } from '../ui';

/** Back to the start screen after this long without a tap, so the next person starts fresh. */
const IDLE_MS = 90_000;

const message = (err: unknown) => (err instanceof ApiFailure ? err.message : 'Something went wrong. Please try again.');

/** Full screen, no app frame: the event's logo, a big title, then the content. */
function Frame({ title, subtitle, children, kiosk = false }: { title: string; subtitle?: string; children: ReactNode; kiosk?: boolean }) {
  const siteEvent = useSiteEvent();
  return (
    <div className={kiosk ? 'signup-page signup-kiosk' : 'signup-page'}>
      <header className="signup-head">
        {siteEvent ? <SiteLogo size={40} /> : <BrandMark size={40} />}
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="signup-sub">{subtitle}</p>}
        </div>
      </header>
      <main className="signup-body" id="main">
        {children}
      </main>
    </div>
  );
}

/** Book, cancel and refresh for one identified person. */
function usePerson(onError: (text: string) => void) {
  const [view, setView] = useState<SignupView | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const call = useCallback(
    async (path: string, body: object, ok?: string) => {
      setBusy(true);
      setDone(null);
      try {
        setView(await api<SignupView>(path, { body }));
        if (ok) setDone(ok);
      } catch (err) {
        onError(message(err));
      } finally {
        setBusy(false);
      }
    },
    [onError],
  );
  return {
    view,
    setView,
    busy,
    done,
    setDone,
    book: (s: SignupSession) => view && void call('/public/signup/book', { pass: view.pass, activityId: s.id }, `Booked: ${s.name}`),
    cancel: (activityId: string) => view && void call('/public/signup/cancel', { pass: view.pass, activityId }, 'Booking cancelled.'),
    createTeam: (activityId: string, name: string) => view && void call('/public/signup/team/create', { pass: view.pass, activityId, name }, `Team made: ${name}. Tell your friends to join it.`),
    joinTeam: (teamId: string, name: string) => view && void call('/public/signup/team/join', { pass: view.pass, teamId }, `You joined ${name}.`),
    leaveTeam: (teamId: string) => view && void call('/public/signup/team/leave', { pass: view.pass, teamId }, 'You left the team.'),
  };
}

/**
 * The sign-up screen, for a tablet at camp HQ. Before anyone scans it shows
 * what's on and how many places are left (no names). Someone scans their
 * lanyard or types its code, books, and taps "Finish and clear screen".
 */
export function SignupKiosk() {
  useTitle('Activity sign-up');
  const { code } = useParams() as { code: string };
  const [params] = useSearchParams();
  const highlight = params.get('activity');
  const [board, setBoard] = useState<{ event: SignupView['event']; open: boolean; sessions: SignupSession[] } | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const person = usePerson(setError);
  const { setView, setDone } = person;
  const [typed, setTyped] = useState('');
  const [kioskTab, setKioskTab] = useState<'activities' | 'teams'>('activities');
  const lastTap = useRef(0);

  const loadBoard = useCallback(() => {
    api<{ event: SignupView['event']; open: boolean; sessions: SignupSession[] }>(`/public/signup/event/${code}`)
      .then(setBoard)
      .catch(() => setMissing(true));
  }, [code]);

  useEffect(() => {
    loadBoard();
    const t = setInterval(loadBoard, 30_000);
    return () => clearInterval(t);
  }, [loadBoard]);

  const reset = useCallback(() => {
    setView(null);
    setDone(null);
    setError(null);
    setTyped('');
    setKioskTab('activities');
    loadBoard();
  }, [loadBoard, setView, setDone]);

  // Kiosk: go back to the start after a while with no taps.
  useEffect(() => {
    if (!person.view) return;
    const touch = () => (lastTap.current = Date.now());
    window.addEventListener('pointerdown', touch);
    const t = setInterval(() => Date.now() - lastTap.current > IDLE_MS && reset(), 5_000);
    lastTap.current = Date.now();
    return () => {
      window.removeEventListener('pointerdown', touch);
      clearInterval(t);
    };
  }, [person.view, reset]);

  const identify = useCallback(
    async (body: object) => {
      setError(null);
      try {
        setView(await api<SignupView>('/public/signup/identify', { body: { ...body, code } }));
      } catch (err) {
        setError(message(err));
      }
    },
    [code, setView],
  );

  if (missing) {
    return (
      <Frame title="Activity sign-up" kiosk>
        <Notice tone="warning" title="This sign-up link doesn't work">
          <p>Ask the event team for the current link or poster.</p>
        </Notice>
      </Frame>
    );
  }
  if (!board) {
    return (
      <Frame title="Activity sign-up" kiosk>
        <Loading what="activities" rows={4} />
      </Frame>
    );
  }
  const wanted = highlight ? board.sessions.find((s) => s.id === highlight) : null;
  const subtitle = `${board.event.name} · ${formatDateRange(board.event.startsOn, board.event.endsOn)}`;

  if (person.view) {
    return (
      <Frame title={`Hi ${person.view.person.name}`} subtitle={person.view.person.groupName || subtitle} kiosk>
        {error && <Notice tone="error">{error}</Notice>}
        {person.done && (
          <Notice tone="success" live>
            <p>{person.done}</p>
          </Notice>
        )}
        {person.view.teamEvents?.length ? (
          <Segmented
            block
            label="Show"
            value={kioskTab}
            onChange={setKioskTab}
            options={[
              { value: 'activities', label: 'Activities' },
              { value: 'teams', label: 'Teams' },
            ]}
          />
        ) : null}
        {kioskTab === 'teams' && person.view.teamEvents?.length ? (
          <TeamsPanel
            teamEvents={person.view.teamEvents}
            tz={person.view.event.timezone}
            busy={person.busy}
            onCreate={(id, name) => person.createTeam(id, name)}
            onJoin={(id, name) => person.joinTeam(id, name)}
            onLeave={(id) => person.leaveTeam(id)}
          />
        ) : (
          <SignupPanel view={person.view} highlight={highlight} busy={person.busy} onBook={(s) => person.book(s)} onCancel={(id) => person.cancel(id)} />
        )}
        <Button kind="primary" block onClick={reset}>
          Finish and clear screen
        </Button>
      </Frame>
    );
  }

  return (
    <Frame title="Activity sign-up" subtitle={subtitle} kiosk>
      {!board.open ? (
        <Notice tone="warning" title="Sign-up isn't open right now">
          <p>Check with a leader.</p>
        </Notice>
      ) : (
        <div className="kiosk">
          <section className="kiosk-scan" aria-labelledby="kiosk-scan-heading">
            {wanted && (
              <Notice title={`Signing up for ${wanted.name}`}>
                <p>Scan your lanyard to book.</p>
              </Notice>
            )}
            <h2 id="kiosk-scan-heading">Scan your lanyard</h2>
            <LanyardCamera onToken={(token) => void identify({ token })} />
            <form
              className="kiosk-type"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void identify({ shortCode: typed });
              }}
            >
              <Field id="kiosk-code" label="Or type the code under the QR on your card">
                <input
                  className="input input-code"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={9}
                  placeholder="K7QM-3XRP"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value.toUpperCase())}
                />
              </Field>
              <Button type="submit" kind="primary" disabled={typed.replace(/-/g, '').length !== 8}>
                Look up code
              </Button>
            </form>
            {error && <Notice tone="error">{error}</Notice>}
          </section>
          <section className="kiosk-board" aria-labelledby="kiosk-board-heading">
            <h2 id="kiosk-board-heading">What's on</h2>
            <SessionBoard sessions={board.sessions} tz={board.event.timezone} highlight={highlight} />
          </section>
        </div>
      )}
    </Frame>
  );
}

/** Camera that reads lanyard QR codes and hands back the token. */
function LanyardCamera({ onToken }: { onToken: (token: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const last = useRef<{ token: string; at: number } | null>(null);
  const [state, setState] = useState<'off' | 'starting' | 'on' | 'blocked'>('off');

  async function start() {
    setState('starting');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      stream.current = s;
      video.current!.srcObject = s;
      await video.current!.play();
      setState('on');
    } catch {
      setState('blocked');
    }
  }

  useEffect(() => {
    if (state !== 'on') return;
    let detect: ((v: HTMLVideoElement) => Promise<string | null>) | null = null;
    let busy = false;
    void createDetector().then((d) => (detect = d));
    const t = setInterval(async () => {
      if (busy || !detect || !video.current) return;
      busy = true;
      try {
        const value = await detect(video.current);
        const token = value ? parseCredentialPayload(value) : null;
        const now = Date.now();
        if (token && !(last.current?.token === token && now - last.current.at < 4000)) {
          last.current = { token, at: now };
          onToken(token);
        }
      } catch {
        // Ignore frame errors.
      } finally {
        busy = false;
      }
    }, 200);
    return () => clearInterval(t);
  }, [state, onToken]);

  useEffect(() => () => stream.current?.getTracks().forEach((tr) => tr.stop()), []);

  return (
    <div className={`viewfinder kiosk-viewfinder ${state === 'on' ? 'is-live' : ''}`}>
      <video ref={video} playsInline muted aria-hidden="true" />
      {state !== 'on' && (
        <div className="viewfinder-cover">
          {state === 'blocked' ? (
            <p>The camera is blocked. Type the code from your card below.</p>
          ) : (
            <Button kind="primary" onClick={() => void start()} busy={state === 'starting'} busyLabel="Starting camera…">
              <Icon name="camera" />
              Start camera
            </Button>
          )}
        </div>
      )}
      {state === 'on' && <span className="viewfinder-guide" aria-hidden="true" />}
    </div>
  );
}

/**
 * Someone's own lanyard link (the QR on their card, opened on a phone):
 * see and change their activity bookings.
 */
export function MyActivities() {
  useTitle('Your activities');
  // The token is in the URL fragment, which browsers never send to a server.
  const [token] = useState(() => window.location.hash.slice(1));
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const person = usePerson(setError);
  const { setView } = person;
  const [chosenTab, setChosenTab] = useState<'bookings' | 'teams' | 'programme' | null>(null);

  useEffect(() => {
    if (!/^[A-Za-z0-9_-]{22}$/.test(token)) {
      setFailed(true);
      return;
    }
    api<SignupView>('/public/signup/identify', { body: { token } })
      .then(setView)
      .catch(() => setFailed(true));
  }, [token, setView]);

  if (failed) {
    return (
      <Frame title="Your activities">
        <Notice tone="warning" title="This card isn't active">
          <p>It may have been replaced. Ask a leader for help.</p>
        </Notice>
      </Frame>
    );
  }
  if (!person.view) {
    return (
      <Frame title="Your activities">
        <Loading what="your activities">
          <SkeletonRows rows={2} />
          <SkeletonRows rows={4} action />
        </Loading>
      </Frame>
    );
  }
  const v = person.view;
  // Start where there's something to do: bookings when there are any (or any to make), otherwise the programme.
  const tab = chosenTab ?? (v.bookings.length || (v.open && v.sessions.length) ? 'bookings' : 'programme');
  const setTab = (t: 'bookings' | 'teams' | 'programme') => setChosenTab(t);
  const teamEvents = v.teamEvents ?? [];
  return (
    <Frame title={v.person.name} subtitle={`${v.event.name} · ${formatDateRange(v.event.startsOn, v.event.endsOn)}`}>
      {error && <Notice tone="error">{error}</Notice>}
      {person.done && (
        <Notice tone="success" live>
          <p>{person.done}</p>
        </Notice>
      )}
      <Segmented
        block
        label="Show"
        value={tab}
        onChange={setTab}
        options={[
          // With three tabs there's no room for the count on a phone.
          { value: 'bookings', label: v.bookings.length && !teamEvents.length ? `Bookings (${v.bookings.length})` : 'Bookings' },
          ...(teamEvents.length ? [{ value: 'teams' as const, label: 'Teams' }] : []),
          { value: 'programme', label: 'Programme' },
        ]}
      />
      {tab === 'teams' ? (
        <TeamsPanel
          teamEvents={teamEvents}
          tz={v.event.timezone}
          busy={person.busy}
          onCreate={(id, name) => person.createTeam(id, name)}
          onJoin={(id, name) => person.joinTeam(id, name)}
          onLeave={(id) => person.leaveTeam(id)}
        />
      ) : tab === 'bookings' ? (
        <SignupPanel view={v} busy={person.busy} onBook={(s) => person.book(s)} onCancel={(id) => person.cancel(id)} />
      ) : (
        <>
          <OnNow items={v.programme ?? []} tz={v.event.timezone} />
          <Programme items={v.programme ?? []} tz={v.event.timezone} />
        </>
      )}
    </Frame>
  );
}

const nowish = (it: ProgrammeItem, now: number) => {
  if (!it.startsAt) return false;
  const start = Date.parse(it.startsAt);
  const end = it.endsAt ? Date.parse(it.endsAt) : start + 60 * 60_000;
  return now >= start - 5 * 60_000 && now < end;
};
const KIND_WORD: Record<ProgrammeItem['kind'], string> = { activity: '', meal: 'Meal', program: '' };

function ProgrammeRow({ it, tz }: { it: ProgrammeItem; tz: string }) {
  return (
    <li className="row">
      <span className="programme-time num">{it.startsAt ? timeInZone(it.startsAt, tz) : ''}</span>
      <span className="row-main">
        <span className="row-title">{it.name}</span>
        <span className="row-meta">
          {[it.endsAt ? `until ${timeInZone(it.endsAt, tz)}` : null, it.location, KIND_WORD[it.kind] || null].filter(Boolean).join(' · ')}
        </span>
      </span>
      {it.bookingRequired && <Badge tone="brand">Book first</Badge>}
    </li>
  );
}

/** What's happening right now, at the top, so a glance answers "where should I be?". */
function OnNow({ items, tz }: { items: ProgrammeItem[]; tz: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const on = items.filter((i) => nowish(i, now));
  if (on.length === 0) return null;
  return (
    <section className="signup-section" aria-labelledby="on-now">
      <h2 id="on-now">On now</h2>
      <ul className="list">
        {on.map((it, i) => (
          <ProgrammeRow key={i} it={it} tz={tz} />
        ))}
      </ul>
    </section>
  );
}

/** The whole camp programme, day by day, then the activities you can do any time. */
function Programme({ items, tz }: { items: ProgrammeItem[]; tz: string }) {
  const timed = items.filter((i) => i.startsAt);
  const anyTime = items.filter((i) => !i.startsAt && i.kind === 'activity');
  if (items.length === 0) return null;
  const days = [...new Set(timed.map((i) => dayInZone(i.startsAt!, tz)))];
  return (
    <section className="signup-section" aria-labelledby="programme">
      <h2 id="programme">Camp programme</h2>
      {days.map((d) => (
        <div key={d} className="list">
          <h3 className="list-group-heading">{dayLabel(d, 'long')}</h3>
          <ul>
            {timed
              .filter((i) => dayInZone(i.startsAt!, tz) === d)
              .map((it, i) => (
                <ProgrammeRow key={i} it={it} tz={tz} />
              ))}
          </ul>
        </div>
      ))}
      {anyTime.length > 0 && (
        <div className="list">
          <h3 className="list-group-heading">Activities you can do</h3>
          <ul>
            {anyTime.map((it, i) => (
              <ProgrammeRow key={i} it={it} tz={tz} />
            ))}
          </ul>
        </div>
      )}
      {items.some((i) => i.bookingRequired) && <p className="meta">Activities marked "Book first" need a booking. Book them on the Bookings tab, or at the sign-up screen.</p>}
    </section>
  );
}
