import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { parseCredentialPayload } from '../../shared/credentials';
import { ApiFailure, api } from '../api';
import { Icon } from '../components/Icon';
import { SessionBoard, SignupPanel } from '../components/SignupPanel';
import type { SignupSession, SignupView } from '../components/SignupPanel';
import { Field, Notice, formatDateRange } from '../components/ui';
import { createDetector } from '../scan/decoder';

/** Back to the start screen after this long without a tap, so the next person starts fresh. */
const IDLE_MS = 90_000;

const message = (err: unknown) => (err instanceof ApiFailure ? err.message : 'Something went wrong. Please try again.');

function Frame({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="signup-page">
      <header className="signup-band">
        <p className="wordmark">{title}</p>
        {subtitle && <p>{subtitle}</p>}
      </header>
      <main className="signup-body">{children}</main>
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
  };
}

/**
 * The sign-up screen, for a tablet at camp HQ. Before anyone scans it shows
 * what's on and how many places are left (no names). Someone scans their
 * lanyard or types its code, books, and taps Done.
 */
export function SignupKiosk() {
  const { code } = useParams() as { code: string };
  const [params] = useSearchParams();
  const highlight = params.get('activity');
  const [board, setBoard] = useState<{ event: SignupView['event']; open: boolean; sessions: SignupSession[] } | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const person = usePerson(setError);
  const { setView, setDone } = person;
  const [typed, setTyped] = useState('');
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
      <Frame title="Activity sign-up">
        <Notice tone="warn" title="This sign-up link doesn't work">
          <p>Ask the event team for the current link or poster.</p>
        </Notice>
      </Frame>
    );
  }
  if (!board) {
    return (
      <Frame title="Activity sign-up">
        <p className="lede">Loading…</p>
      </Frame>
    );
  }
  const wanted = highlight ? board.sessions.find((s) => s.id === highlight) : null;
  const subtitle = `${board.event.name} · ${formatDateRange(board.event.startsOn, board.event.endsOn)}`;

  if (person.view) {
    return (
      <Frame title={`Hi ${person.view.person.name}`} subtitle={person.view.person.groupName || subtitle}>
        {error && <Notice tone="stop">{error}</Notice>}
        {person.done && <Notice tone="ok">{person.done}</Notice>}
        <SignupPanel view={person.view} highlight={highlight} busy={person.busy} onBook={(s) => person.book(s)} onCancel={(id) => person.cancel(id)} />
        <button className="btn btn-block btn-done" onClick={reset}>
          Done
        </button>
      </Frame>
    );
  }

  return (
    <Frame title="Activity sign-up" subtitle={subtitle}>
      {!board.open ? (
        <Notice tone="warn" title="Sign-up isn't open right now">
          <p>Check with a leader.</p>
        </Notice>
      ) : (
        <div className="kiosk">
          <section className="kiosk-scan">
            {wanted && (
              <p className="wanted flush">
                Signing up for <strong>{wanted.name}</strong>. Scan your lanyard to book.
              </p>
            )}
            <h1>Scan your lanyard</h1>
            <LanyardCamera onToken={(token) => void identify({ token })} />
            <form
              className="kiosk-type"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void identify({ shortCode: typed });
              }}
            >
              <Field id="kiosk-code" label="Or type the code under the QR on your card">
                <div className="inline-form">
                  <input
                    id="kiosk-code"
                    className="input input-code"
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={9}
                    placeholder="K7QM-3XRP"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value.toUpperCase())}
                  />
                  <button className="btn" disabled={typed.replace(/-/g, '').length !== 8}>
                    Go
                  </button>
                </div>
              </Field>
            </form>
            {error && <Notice tone="stop">{error}</Notice>}
          </section>
          <section className="kiosk-board">
            <h2>What's on</h2>
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
            <button className="btn btn-light" onClick={() => void start()} disabled={state === 'starting'}>
              <Icon name="camera" /> {state === 'starting' ? 'Starting camera…' : 'Start camera'}
            </button>
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
  // The token is in the URL fragment, which browsers never send to a server.
  const [token] = useState(() => window.location.hash.slice(1));
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const person = usePerson(setError);
  const { setView } = person;

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
      <Frame title="CampCount">
        <Notice tone="warn" title="This card isn't active">
          <p>It may have been replaced. Ask a leader for help.</p>
        </Notice>
      </Frame>
    );
  }
  if (!person.view) {
    return (
      <Frame title="CampCount">
        <p className="lede">Loading…</p>
      </Frame>
    );
  }
  const v = person.view;
  return (
    <Frame title={v.person.name} subtitle={`${v.event.name} · ${formatDateRange(v.event.startsOn, v.event.endsOn)}`}>
      {error && <Notice tone="stop">{error}</Notice>}
      {person.done && <Notice tone="ok">{person.done}</Notice>}
      <SignupPanel view={v} busy={person.busy} onBook={(s) => person.book(s)} onCancel={(id) => person.cancel(id)} />
    </Frame>
  );
}
