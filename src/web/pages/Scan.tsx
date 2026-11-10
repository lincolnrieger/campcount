import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import type { ContextType, Direction, PersonState } from '../../shared/scanRules';
import { matchesSearch, searchRank } from '../../shared/search';
import { useSyncStatus } from '../offline/sync';
import { createDetector } from '../scan/decoder';
import { rememberLastScan, useEventSummary } from '../scan/targets';
import type { Feedback, ScanInput, Snapshot, SnapshotPerson } from '../scan/useScanSession';
import { useScanSession } from '../scan/useScanSession';
import { useSession } from '../session';
import { useTitle } from '../shell';
import { Badge, Button, ButtonLink, Choice, Icon, IconButton, Loading, Notice, SearchField, Segmented, Skeleton, SkeletonRows, useConfirm } from '../ui';
import { scanOnly } from './EventLayout';

const SAME_CODE_COOLDOWN_MS = 3000;
const TZ = 'Australia/Adelaide';
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: TZ });

/** Set while a camera was running, so the next scanner opened from the menu starts its camera straight away. */
let resumeCamera = false;
/** Beep on scan: remembered for this visit, across scanners. */
let soundOn = true;

let audio: AudioContext | null = null;
function signal(tone: Feedback['tone'], sound: boolean) {
  navigator.vibrate?.(tone === 'ok' ? 60 : [80, 60, 80, 60, 80]);
  if (!sound) return;
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = tone === 'ok' ? 880 : tone === 'warn' ? 440 : 220;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + (tone === 'ok' ? 0.12 : 0.35));
  } catch {
    // Sound is a nicety; ignore failures.
  }
}

/** Upload state for this phone, one short line under the scanner's title: synced, waiting, offline or blocked. */
function SyncLine() {
  const s = useSyncStatus();
  let text: string;
  let tone: 'ok' | 'warn' | 'stop' = 'ok';
  let icon: 'sync' | 'offline' | 'warning' = 'sync';
  if (s.state === 'blocked') {
    text = s.message ?? 'Upload blocked';
    tone = 'stop';
    icon = 'warning';
  } else if (s.pending > 0) {
    text = `${s.pending} to upload${s.state === 'offline' ? ', no signal' : ''}`;
    tone = 'warn';
    icon = s.state === 'offline' ? 'offline' : 'sync';
  } else if (s.state === 'offline') {
    text = 'No signal. Scans are kept on this phone';
    tone = 'warn';
    icon = 'offline';
  } else {
    text = s.lastSyncAt ? `All uploaded ${clock(s.lastSyncAt)}` : 'All uploaded';
  }
  return (
    <p className={`scanner-sync sync-${tone}`} role="status">
      <Icon name={icon} size={16} />
      <span>{text}</span>
    </p>
  );
}

const RESULT_ICON = { ok: 'check', warn: 'warning', stop: 'cross' } as const;

const isAllergy = (alert: string) => /allergy|anaphyla/i.test(alert);

/**
 * Dietary needs, impossible to miss: a solid red block across the result,
 * so the person serving sees it before they hand over a plate.
 */
function DietaryAlert({ alert }: { alert: string }) {
  const allergy = isAllergy(alert);
  return (
    <div className="diet-alert" role="alert">
      <p className="diet-alert-word">
        <Icon name="warning" size={24} />
        {allergy ? 'Allergy' : 'Dietary needs'}
      </p>
      <p className="diet-alert-text">{alert.replace(/^allergy:\s*/i, '')}</p>
      <p className="diet-alert-note">Check their food before serving.</p>
    </div>
  );
}

/** The big answer after each scan: icon, word and name. Announced to screen readers. */
function ScanResult({ feedback, contextType }: { feedback: Feedback | null; contextType: ContextType }) {
  if (!feedback) {
    return (
      <div className="scan-result scan-result-idle" role="status">
        <p className="scan-result-word">Ready</p>
        <p className="scan-result-meta">Hold a lanyard's QR code inside the square.</p>
      </div>
    );
  }
  const p = feedback.person;
  const alert = contextType === 'meal' ? p?.dietaryAlert : null;
  return (
    <div className={`scan-result scan-result-${feedback.tone}`} role={feedback.tone === 'stop' ? 'alert' : 'status'} aria-atomic="true">
      <p className="scan-result-word">
        <Icon name={RESULT_ICON[feedback.tone]} size={24} />
        {feedback.title}
      </p>
      {p && <p className="scan-result-name">{p.fullName ?? p.name}</p>}
      {p && <p className="scan-result-meta">{[p.group, p.section].filter(Boolean).join(' · ')}</p>}
      {feedback.message && <p>{feedback.message}</p>}
      {feedback.warning && <p>{feedback.warning}</p>}
      {alert && <DietaryAlert alert={alert} />}
      {p?.noPhotos && (
        <p className="scan-flag">
          <Icon name="eye" size={16} />
          No photos
        </p>
      )}
    </div>
  );
}

/**
 * The scanner: full screen, camera first, a huge result after each scan.
 * Works offline: scans queue on the phone and upload when there's signal.
 */
export function Scan() {
  const { eventId, type, contextId } = useParams() as { eventId: string; type: ContextType; contextId?: string };
  const session = useScanSession(eventId, type, contextId ?? null);
  const { me, signOut } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const station = me?.kind === 'station';
  const eventSummary = useEventSummary(me?.kind === 'user' ? eventId : null);
  // People who only scan live in the scanner: no close button, their account is a tab.
  const scanOnlyUser = me?.kind === 'user' && eventSummary !== null && scanOnly(eventSummary);
  useTitle(session.snapshot ? `Scan: ${session.snapshot.context.type === 'site' ? 'Gate' : session.snapshot.context.name}` : 'Scan');

  const [tab, setTab] = useState<'scan' | 'find' | 'list' | 'more'>('scan');
  const [direction, setDirection] = useState<Direction>('in');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [camera, setCamera] = useState<'off' | 'starting' | 'on' | 'denied' | 'unavailable'>('off');
  const [sound, setSoundState] = useState(soundOn);
  const setSound = (v: boolean) => {
    soundOn = v;
    setSoundState(v);
  };
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastCode = useRef<{ value: string; at: number } | null>(null);
  const recordRef = useRef<(input: ScanInput) => Promise<void>>(async () => undefined);

  const rules = session.snapshot?.context.rules;
  const twoWay = rules?.type === 'site' || (rules?.type === 'activity' && rules.trackSignOut);

  const record = useCallback(
    async (input: ScanInput) => {
      try {
        const result = await session.record(input, direction);
        setFeedback(result);
        // A dietary alert at a meal always gets the long buzz, even when the scan went through.
        signal(type === 'meal' && result.person?.dietaryAlert ? 'stop' : result.tone, sound);
      } catch {
        // A scan is already being processed, or the list is still loading.
      }
    },
    [session, direction, sound, type],
  );
  useEffect(() => {
    recordRef.current = record;
  }, [record]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamera('off');
  }, []);

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('unavailable');
      return;
    }
    setCamera('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setCamera('on');
    } catch (err) {
      setCamera(err instanceof DOMException && err.name === 'NotAllowedError' ? 'denied' : 'unavailable');
    }
  }

  // Decode loop while the camera runs.
  useEffect(() => {
    if (camera !== 'on') return;
    let cancelled = false;
    let detecting = false;
    let detect: ((v: HTMLVideoElement) => Promise<string | null>) | null = null;
    void createDetector().then((d) => (detect = d));
    const timer = setInterval(async () => {
      if (cancelled || detecting || !detect || !videoRef.current) return;
      detecting = true;
      try {
        const value = await detect(videoRef.current);
        const now = Date.now();
        if (value && !(lastCode.current?.value === value && now - lastCode.current.at < SAME_CODE_COOLDOWN_MS)) {
          lastCode.current = { value, at: now };
          await recordRef.current({ kind: 'qr', payload: value });
        } else if (value) {
          lastCode.current = { value, at: now };
        }
      } catch {
        // Ignore frame errors.
      } finally {
        detecting = false;
      }
    }, 180);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [camera]);

  useEffect(() => stopCamera, [stopCamera]);
  // Start the camera without a tap when it's already allowed, or when switching from another scanner.
  // Waits for the list to load: until then there's no video element to show the camera in.
  const startRef = useRef(startCamera);
  const ready = Boolean(session.snapshot);
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!ready || autoStarted.current) return;
    autoStarted.current = true;
    if (resumeCamera) {
      resumeCamera = false;
      void startRef.current();
      return;
    }
    navigator.permissions
      ?.query({ name: 'camera' as PermissionName })
      .then((p) => {
        if (p.state === 'granted') void startRef.current();
      })
      .catch(() => undefined);
  }, [ready]);
  const contextName = session.snapshot?.context.name;
  useEffect(() => {
    if (contextName && me?.kind === 'user') rememberLastScan({ eventId, to: location.pathname, label: contextName });
  }, [contextName, eventId, location.pathname, me?.kind]);
  // Warm the fallback decoder while online so the service worker caches it for offline use.
  useEffect(() => {
    void import('jsqr');
  }, []);
  // The camera rests while another tab is open, and comes back with the Scan tab.
  const cameraWasOn = useRef(false);
  useEffect(() => {
    if (tab !== 'scan') {
      if (streamRef.current) {
        cameraWasOn.current = true;
        stopCamera();
      }
    } else if (cameraWasOn.current) {
      cameraWasOn.current = false;
      void startRef.current();
    }
  }, [tab, stopCamera]);

  const counts = useMemo(() => {
    const values = [...session.states.map.values()];
    return {
      present: session.states.presentNow,
      people: values.filter((s) => s.visits > 0).length,
      total: session.snapshot?.people.filter((p) => !p.withdrawn).length ?? 0,
    };
  }, [session.states, session.snapshot]);

  const close = () => {
    resumeCamera = camera === 'on';
    stopCamera();
    if (window.history.length > 1 && location.key !== 'default') navigate(-1);
    else navigate(`/scan?event=${eventId}`);
  };

  if (session.loadError) {
    return (
      <div className="scanner">
        <div className="scanner-inner">
          <Notice tone="error" title="Couldn't load this scanner">
            <p>{session.loadError}</p>
            <Link to={`/scan?event=${eventId}`}>Back to Scan</Link>
          </Notice>
        </div>
      </div>
    );
  }
  if (!session.snapshot)
    return (
      <div className="scanner">
        <div className="scanner-inner">
          <Loading what="the list for this phone">
            <Skeleton width="12rem" height="var(--text-xl)" className="" />
            <Skeleton width="100%" height="min(60vh, 100vw)" className="" />
            <SkeletonRows rows={2} />
          </Loading>
        </div>
      </div>
    );

  const ctx = session.snapshot.context;
  const title = ctx.type === 'site' ? 'Gate' : ctx.name;
  // The running count, top right: big number, a few words under it.
  const count =
    ctx.type === 'meal'
      ? { value: counts.present, of: counts.total, words: 'served' }
      : ctx.type === 'site'
        ? { value: counts.present, of: counts.total, words: 'on site' }
        : { value: counts.people, of: null, words: 'checked in' };
  const listLabel = ctx.type === 'meal' ? 'Eaten' : ctx.type === 'site' ? 'On site' : 'Checked in';
  const backToScan = () => setTab('scan');
  return (
    <div className="scanner">
      <div className={`scanner-inner scanner-on-${tab}`}>
        <header className="scanner-head">
          {!station && !scanOnlyUser && (
            <IconButton label="Close scanner" onClick={close}>
              <Icon name="close" size={24} />
            </IconButton>
          )}
          <div className="scanner-title">
            <h1>{title}</h1>
            <SyncLine />
          </div>
          <p className="scanner-count num">
            <span className="scanner-count-value">
              {count.value}
              {count.of !== null && count.of > 0 && <span className="scanner-count-of">/{count.of}</span>}
            </span>
            <span className="scanner-count-words">{count.words}</span>
          </p>
        </header>

        <div className="scanner-body" hidden={tab !== 'scan'}>
          {twoWay && (
            <Segmented
              block
              label="Scan direction"
              value={direction}
              onChange={setDirection}
              options={[
                { value: 'in', label: ctx.type === 'site' ? 'Arriving' : 'Signing in' },
                { value: 'out', label: ctx.type === 'site' ? 'Leaving' : 'Signing out' },
              ]}
            />
          )}
          <div className={camera === 'on' ? 'viewfinder is-live' : 'viewfinder'}>
            <video ref={videoRef} playsInline muted aria-hidden="true" />
            {camera !== 'on' && (
              <div className="viewfinder-cover">
                {camera === 'denied' ? (
                  <p>The camera is blocked. Allow it for this site in your browser's settings, or use the Find tab.</p>
                ) : camera === 'unavailable' ? (
                  <p>This browser can't use the camera. Use the Find tab instead.</p>
                ) : (
                  <Button kind="primary" onClick={() => void startCamera()} busy={camera === 'starting'} busyLabel="Starting camera…">
                    <Icon name="camera" />
                    Start camera
                  </Button>
                )}
              </div>
            )}
            {camera === 'on' && <span className="viewfinder-guide" aria-hidden="true" />}
          </div>
          <ScanResult feedback={feedback} contextType={ctx.type} />
        </div>

        {tab === 'find' && (
          <div className="scanner-panel">
            <h2>Find someone without their lanyard</h2>
            <FindByName
              people={session.snapshot.people}
              onCode={(code) => {
                backToScan();
                void record({ kind: 'code', code });
              }}
              onPick={async (p) => {
                const name = p.fullName ?? p.name;
                const ok = await confirm({
                  title: `Record ${name}?`,
                  body: <p>{p.group}. This is saved as a hand entry, without their card.</p>,
                  confirm: 'Record',
                });
                if (!ok) return;
                backToScan();
                void record({ kind: 'manual', registrationId: p.id });
              }}
            />
          </div>
        )}

        {tab === 'list' && <WhoList snapshot={session.snapshot} states={session.states.map} />}

        {tab === 'more' && (
          <div className="scanner-panel">
            <div>
              <p className="meta">{session.snapshot.event.name}</p>
              <h2>{station ? `This phone only scans ${ctx.type === 'site' ? 'the gate' : ctx.name}` : `Scanning ${ctx.type === 'site' ? 'the gate' : ctx.name}`}</h2>
            </div>
            {session.fromCache && <Notice tone="warning">Using the list saved on this phone. Scans from other phones show up once you have signal.</Notice>}
            <Choice checked={sound} onChange={(e) => setSound(e.target.checked)} label="Beep on each scan" description="The phone also buzzes if it can." />
            {station ? (
              <Button block onClick={() => void signOut()}>
                Unpair this device
              </Button>
            ) : (
              <>
                <Button block onClick={() => navigate(`/scan?event=${eventId}&pick=1`)}>
                  <Icon name="scan" />
                  Scan something else
                </Button>
                {me?.kind === 'user' && (
                  <div>
                    <p className="row-title">{me.user.displayName}</p>
                    <p className="meta">{me.user.email}</p>
                  </div>
                )}
                <ButtonLink block to="/account">
                  Account settings
                </ButtonLink>
                <Button block kind="ghost" onClick={() => void signOut()}>
                  Sign out
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      <nav className="scanner-tabs" aria-label="Scanner">
        {(
          [
            { key: 'scan', label: 'Scan', icon: 'scan' },
            { key: 'find', label: 'Find', icon: 'search' },
            { key: 'list', label: listLabel, icon: 'check' },
            { key: 'more', label: 'More', icon: 'more' },
          ] as const
        ).map((t) => (
          <button key={t.key} type="button" aria-current={tab === t.key ? 'page' : undefined} onClick={() => setTab(t.key)}>
            <Icon name={t.icon} size={24} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

/** Search the list saved on this phone (works offline), or type the code printed on the card. */
function FindByName({ people, onPick, onCode }: { people: SnapshotPerson[]; onPick: (p: SnapshotPerson) => void; onCode: (code: string) => void }) {
  const [q, setQ] = useState('');
  const [typing, setTyping] = useState(false);
  const [code, setCode] = useState('');
  const matches = q.trim()
    ? people
        .filter((p) => matchesSearch(q, p.fullName ?? p.name, p.memberNumber))
        .sort((a, b) => searchRank(q, a.fullName ?? a.name) - searchRank(q, b.fullName ?? b.name) || (a.fullName ?? a.name).localeCompare(b.fullName ?? b.name))
        .slice(0, 30)
    : [];
  if (typing) {
    const submit = (e: FormEvent) => {
      e.preventDefault();
      onCode(code);
    };
    return (
      <form className="form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="typed-code" className="field-label">
            Code printed under the QR
          </label>
          <input
            id="typed-code"
            className="input input-code"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={9}
            value={code}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="K7QM-3XRP"
          />
        </div>
        <div className="btn-row">
          <Button type="submit" kind="primary" disabled={code.replace(/-/g, '').length !== 8}>
            Record
          </Button>
          <Button kind="ghost" onClick={() => setTyping(false)}>
            Search by name instead
          </Button>
        </div>
      </form>
    );
  }
  return (
    <>
      {/* They opened the Find tab to type a name: put them straight in the box. */}
      {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
      <SearchField id="name-q" label="Name or membership number" value={q} onChange={setQ} autoFocus />
      {q.trim() === '' ? (
        <p className="meta">Start typing. Even one letter works. It's saved as a hand entry.</p>
      ) : matches.length === 0 ? (
        <p className="meta">No one on this list matches "{q}".</p>
      ) : (
        <ul className="list">
          {matches.map((p) => (
            <li key={p.id}>
              <button type="button" className="row row-button" onClick={() => onPick(p)}>
                <span className="row-main">
                  <span className="row-title">{p.fullName ?? p.name}</span>
                  <span className="row-meta">{p.group}</span>
                </span>
                <Icon name="chevron" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button kind="ghost" onClick={() => setTyping(true)}>
          <Icon name="keyboard" />
          Type the card code instead
        </Button>
      </div>
    </>
  );
}

/**
 * Who has and hasn't been scanned here: eaten / not yet at a meal, checked in
 * / not yet at an activity, on site / not arrived at the gate. Built from the
 * list saved on this phone plus its own scans, so it works with no signal.
 */
function WhoList({ snapshot, states }: { snapshot: Snapshot; states: Map<string, PersonState> }) {
  const ctx = snapshot.context;
  const [show, setShow] = useState<'not' | 'done'>('not');
  const [q, setQ] = useState('');
  const people = snapshot.people.filter((p) => !p.withdrawn);
  // At an activity with bookings, "Not yet" is who's booked and hasn't come. Otherwise it's everyone.
  const bookings = ctx.type === 'activity' && people.some((p) => p.booked);
  const done = people.filter((p) => (states.get(p.id)?.visits ?? 0) > 0);
  const notYet = people.filter((p) => (states.get(p.id)?.visits ?? 0) === 0 && (!bookings || p.booked));
  const words =
    ctx.type === 'meal'
      ? { not: 'Not yet', done: 'Eaten', allDone: 'Everyone has eaten.', none: 'No one has eaten yet.' }
      : ctx.type === 'site'
        ? { not: 'Not arrived', done: 'Arrived', allDone: 'Everyone has arrived.', none: 'No one has arrived yet.' }
        : { not: bookings ? 'Booked, not here' : 'Not yet', done: 'Checked in', allDone: 'Everyone booked has checked in.', none: 'No one has checked in yet.' };
  const name = (p: SnapshotPerson) => p.fullName ?? p.name;
  const list = (show === 'done' ? done : notYet)
    .filter((p) => matchesSearch(q, name(p), p.memberNumber))
    .sort((a, b) => (show === 'done' ? (states.get(b.id)?.lastAcceptedAt ?? '').localeCompare(states.get(a.id)?.lastAcceptedAt ?? '') : name(a).localeCompare(name(b))));
  const status = (p: SnapshotPerson) => {
    const s = states.get(p.id);
    if (!s?.lastAcceptedAt) return null;
    if (ctx.type === 'activity' && ctx.rules.type === 'activity' && ctx.rules.trackSignOut) return s.present ? 'Here' : 'Left';
    if (ctx.type === 'site') return s.present ? 'On site' : 'Left';
    return null;
  };
  return (
    <div className="scanner-list">
      <Segmented
        block
        label="Show"
        value={show}
        onChange={setShow}
        options={[
          { value: 'not', label: `${words.not} (${notYet.length})` },
          { value: 'done', label: `${words.done} (${done.length})` },
        ]}
      />
      <SearchField id="who-q" label="Search names" value={q} onChange={setQ} />
      {list.length === 0 ? (
        <p className="meta">{q ? `No one matches "${q}".` : show === 'not' ? words.allDone : words.none}</p>
      ) : (
        <ul className="list">
          {list.map((p) => {
            const s = states.get(p.id);
            const st = status(p);
            return (
              <li key={p.id} className="row">
                <span className="row-main">
                  <span className="row-title">{name(p)}</span>
                  <span className="row-meta">{[p.group, st].filter(Boolean).join(' · ')}</span>
                </span>
                {ctx.type === 'meal' && p.dietaryAlert && <Badge tone="error">{isAllergy(p.dietaryAlert) ? 'Allergy' : 'Dietary'}</Badge>}
                {s?.lastAcceptedAt && <span className="meta num">{clock(s.lastAcceptedAt)}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
