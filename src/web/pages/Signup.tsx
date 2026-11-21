import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { parseCredentialPayload } from '../../shared/credentials';
import { ApiFailure, api } from '../api';
import { SessionBoard, SignupPanel } from '../components/SignupPanel';
import { TeamsPanel } from '../components/TeamsPanel';
import type { SignupSession, SignupView } from '../components/SignupPanel';
import { createDetector } from '../scan/decoder';
import { useTitle } from '../shell';
import { useSiteEvent } from '../site';
import { BrandMark } from '../ui/AppShell';
import { SiteLogo } from '../ui/SiteShell';
import { Button, Field, Icon, Loading, Notice, Segmented, formatDateRange } from '../ui';
import { usePolling } from '../usePolling';

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

/** What just happened (booked, cancelled, or what went wrong), pinned to the bottom of the screen so it's seen wherever you tapped. */
export function SignupStatus({ error, done }: { error: string | null; done: string | null }) {
  return (
    <div className="signup-status" role="status" aria-live="polite">
      {error ? (
        <p className="signup-status-msg is-error">
          <Icon name="error" size={20} />
          {error}
        </p>
      ) : done ? (
        <p className="signup-status-msg">
          <Icon name="success" size={20} />
          {done}
        </p>
      ) : null}
    </div>
  );
}

/** Book, cancel and refresh for one identified person. */
export function usePerson(onError: (text: string) => void) {
  const [view, setView] = useState<SignupView | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  // The confirmation fades after a few seconds.
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), 4000);
    return () => clearTimeout(t);
  }, [done]);
  const call = useCallback(
    async (path: string, body: object, ok?: string) => {
      setBusy(true);
      setDone(null);
      onError(''); // clear the last problem
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
    createTeam: (activityId: string, name: string, locked: boolean) =>
      view && void call('/public/signup/team/create', { pass: view.pass, activityId, name, locked }, `Team made: ${name}.`),
    joinTeam: (teamId: string, name: string) => view && void call('/public/signup/team/join', { pass: view.pass, teamId }, `You joined ${name}.`),
    joinTeamWithCode: (activityId: string, code: string) => view && void call('/public/signup/team/join-code', { pass: view.pass, activityId, code }, 'You joined the team.'),
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
  }, [loadBoard]);
  usePolling(loadBoard, 30_000);

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
        <SignupStatus error={error} done={person.done} />
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
            onCreate={(id, name, locked) => person.createTeam(id, name, locked)}
            onJoin={(id, name) => person.joinTeam(id, name)}
            onJoinCode={(id, code) => person.joinTeamWithCode(id, code)}
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
              <Field id="kiosk-code" label="Or type your membership number (it’s on your card)">
                <input
                  className="input input-code"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={24}
                  inputMode="text"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value.toUpperCase())}
                />
              </Field>
              <Button type="submit" kind="primary" disabled={typed.replace(/[\s-]/g, '').length < 3}>
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
