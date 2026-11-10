import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import type { ContextType, Direction, PersonState } from '../../shared/scanRules';
import { matchesSearch, searchRank } from '../../shared/search';
import { contextEntries } from '../offline/db';
import { syncNow, useSyncStatus } from '../offline/sync';
import { ApiFailure, api } from '../api';
import { createDetector } from '../scan/decoder';
import { useEventSummary } from '../scan/targets';
import type { Feedback, ScanInput, Snapshot, SnapshotPerson } from '../scan/useScanSession';
import { useScanSession } from '../scan/useScanSession';
import { useSession } from '../session';
import { useTitle } from '../shell';
import { Badge, Button, ButtonLink, Choice, Icon, IconButton, Loading, Notice, SearchField, Segmented, Sheet, Skeleton, SkeletonRows, useConfirm, useToast } from '../ui';
import { scanOnly } from './EventLayout';
import { ScanSwitcher } from './ScanHub';

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

/**
 * Only shown when something needs attention: no signal, scans waiting, or
 * uploads blocked. When everything has uploaded there's nothing to read.
 */
function SyncProblem() {
  const s = useSyncStatus();
  let text: string;
  let tone: 'warn' | 'stop' = 'warn';
  let icon: 'sync' | 'offline' | 'warning' = 'sync';
  if (s.state === 'blocked') {
    text = s.message ?? 'Scans are not uploading. Ask the camp organiser.';
    tone = 'stop';
    icon = 'warning';
  } else if (s.pending > 0 && s.state === 'offline') {
    text = `No signal. ${s.pending} scan${s.pending === 1 ? ' is' : 's are'} saved on this phone and will upload later.`;
    icon = 'offline';
  } else if (s.state === 'offline') {
    text = 'No signal. Keep scanning: scans are saved on this phone.';
    icon = 'offline';
  } else {
    return null;
  }
  return (
    <p className={`scanner-sync sync-${tone}`} role="status">
      <Icon name={icon} size={20} />
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
        <p className="scan-result-meta">Point the camera at a lanyard's QR code.</p>
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
  const toast = useToast();
  const station = me?.kind === 'station';
  const eventSummary = useEventSummary(me?.kind === 'user' ? eventId : null);
  // People who only scan live in the scanner: no close button, their account is under Settings.
  const scanOnlyUser = me?.kind === 'user' && eventSummary !== null && scanOnly(eventSummary);
  useTitle(session.snapshot ? `Scan: ${session.snapshot.context.type === 'site' ? 'Gate' : session.snapshot.context.name}` : 'Scan');

  const [view, setView] = useState<'camera' | 'people'>('camera');
  const [sheet, setSheet] = useState<'none' | 'change' | 'settings' | 'code'>('none');
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
  // Warm the fallback decoder while online so the service worker caches it for offline use.
  useEffect(() => {
    void import('jsqr');
  }, []);
  // The camera rests while the list is open, and comes back with the scanner.
  const cameraWasOn = useRef(false);
  useEffect(() => {
    if (view !== 'camera') {
      if (streamRef.current) {
        cameraWasOn.current = true;
        stopCamera();
      }
    } else if (cameraWasOn.current) {
      cameraWasOn.current = false;
      void startRef.current();
    }
  }, [view, stopCamera]);

  const counts = useMemo(() => {
    const values = [...session.states.map.values()];
    return {
      present: session.states.presentNow,
      people: values.filter((s) => s.visits > 0).length,
      total: session.snapshot?.people.filter((p) => !p.withdrawn).length ?? 0,
    };
  }, [session.states, session.snapshot]);

  /** Take someone off Eaten / Checked in, after their scan has reached the server. */
  const removePerson = async (p: SnapshotPerson) => {
    const ctx = session.snapshot?.context;
    if (!ctx || ctx.type === 'site' || !contextId) return;
    const name = p.fullName ?? p.name;
    const from = ctx.type === 'meal' ? 'Eaten' : 'Checked in';
    const ok = await confirm({
      title: `Undo ${name}?`,
      body: <p>Takes them off {from}, so they can be scanned again. It stays in their history, marked as undone.</p>,
      confirm: 'Undo',
      danger: true,
    });
    if (!ok) return;
    await syncNow();
    const waiting = (await contextEntries(`${eventId}:${type}:${contextId}`)).some((e) => !e.synced && e.registrationId === p.id);
    if (waiting) {
      toast(`${name}'s scan hasn't uploaded yet. Try again once there's signal.`, { tone: 'error' });
      return;
    }
    try {
      await api(`/events/${eventId}/scan/${type}/${contextId}/people/${p.id}/remove`, { body: {} });
      await session.refresh();
      toast(`${name} taken off ${from}`);
    } catch (err) {
      toast(err instanceof ApiFailure && err.status !== 0 ? err.message : 'No signal. Try again once you have signal.', { tone: 'error' });
    }
  };

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
  const words = wordsFor(session.snapshot, counts);
  const done = ctx.type === 'activity' ? counts.people : counts.present;
  const backToCamera = () => setView('camera');

  /** Check someone in from the list (no lanyard). Big results — and every dietary alert — show on the camera screen. */
  const checkIn = async (p: SnapshotPerson) => {
    const name = p.fullName ?? p.name;
    const ok = await confirm({
      title: words.ask(name),
      body: <p>{[p.group, 'For someone without their lanyard.'].filter(Boolean).join('. ')}</p>,
      confirm: words.action,
    });
    if (!ok) return;
    try {
      const result = await session.record({ kind: 'manual', registrationId: p.id }, 'in');
      const alert = type === 'meal' && result.person?.dietaryAlert;
      signal(alert ? 'stop' : result.tone, sound);
      setFeedback(result);
      if (alert || result.tone !== 'ok') backToCamera();
      else toast(`${name}: ${result.title}`);
    } catch {
      // The list is still loading.
    }
  };

  return (
    <div className={`scanner scanner-view-${view}`}>
      <div className="scanner-inner">
        <header className="scanner-head">
          {!station && !scanOnlyUser && (
            <IconButton label="Close scanner" onClick={close}>
              <Icon name="close" size={24} />
            </IconButton>
          )}
          <div className="scanner-title">
            <h1>{title}</h1>
            <p className="scanner-count num">{words.count(done, counts.total)}</p>
          </div>
          {eventSummary && !station && (
            <Button className="scanner-change" onClick={() => setSheet('change')}>
              Change
            </Button>
          )}
          <IconButton label="Settings" aria-haspopup="dialog" onClick={() => setSheet('settings')}>
            <Icon name="user" size={24} />
          </IconButton>
        </header>
        <SyncProblem />

        <div className="scanner-body" hidden={view !== 'camera'}>
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
                  <p>The camera is blocked. Allow it for this site in your browser's settings. Until then, use the list below to check people in.</p>
                ) : camera === 'unavailable' ? (
                  <p>This phone's browser can't use the camera. Use the list below to check people in.</p>
                ) : (
                  <Button kind="primary" className="scanner-big" onClick={() => void startCamera()} busy={camera === 'starting'} busyLabel="Starting camera…">
                    <Icon name="camera" size={24} />
                    Start camera
                  </Button>
                )}
              </div>
            )}
            {camera === 'on' && <span className="viewfinder-guide" aria-hidden="true" />}
          </div>
          <ScanResult feedback={feedback} contextType={ctx.type} />
          <Button className="scanner-big scanner-people-btn" block onClick={() => setView('people')}>
            <Icon name="search" size={24} />
            <span>{words.not}</span>
            <span className="scanner-people-count num">{words.notCount}</span>
          </Button>
        </div>

        {view === 'people' && (
          <PeopleList
            snapshot={session.snapshot}
            states={session.states.map}
            words={words}
            onCheckIn={(p) => void checkIn(p)}
            onUndo={ctx.type === 'site' ? undefined : (p) => void removePerson(p)}
            onTypeCode={() => setSheet('code')}
          />
        )}
      </div>

      {view === 'people' && (
        <div className="scanner-dock">
          <Button kind="primary" className="scanner-big" block onClick={backToCamera}>
            <Icon name="camera" size={24} />
            Back to camera
          </Button>
        </div>
      )}

      {eventSummary && !station && (
        <ScanSwitcher
          event={eventSummary}
          currentKey={ctx.type === 'site' ? 'site' : `${ctx.type}:${ctx.id}`}
          open={sheet === 'change'}
          onClose={() => setSheet('none')}
          onSwitch={() => {
            resumeCamera = camera === 'on' || cameraWasOn.current;
            stopCamera();
          }}
        />
      )}

      <Sheet open={sheet === 'code'} title="Type the code from a card" onClose={() => setSheet('none')}>
        <CodeEntry
          onCode={(code) => {
            setSheet('none');
            backToCamera();
            void record({ kind: 'code', code });
          }}
        />
      </Sheet>

      <Sheet open={sheet === 'settings'} title="Settings" onClose={() => setSheet('none')}>
        <div className="scanner-settings">
          <Choice checked={sound} onChange={(e) => setSound(e.target.checked)} label="Beep on each scan" description="The phone also buzzes if it can." />
          {session.fromCache && <Notice tone="warning">Using the list saved on this phone. Scans from other phones show up once you have signal.</Notice>}
          <div className="scanner-settings-account">
            <p className="meta">{session.snapshot.event.name}</p>
            {station ? (
              <>
                <p>This phone is a scanning station. It only scans {ctx.type === 'site' ? 'the gate' : ctx.name}.</p>
                <Button block onClick={() => void signOut()}>
                  Unpair this device
                </Button>
              </>
            ) : (
              <>
                {me?.kind === 'user' && (
                  <p>
                    Signed in as <strong>{me.user.displayName}</strong>
                  </p>
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
        </div>
      </Sheet>
    </div>
  );
}

interface Words {
  /** Heading of the list of who's still to come, and the big button that opens it. */
  not: string;
  notCount: number;
  done: string;
  doneCount: number;
  /** Short label for the list's own switch. */
  notShort: string;
  /** The button on each name in "not yet", and the question before it records. */
  action: string;
  ask: (name: string) => string;
  count: (done: number, total: number) => string;
  allDone: string;
  noneDone: string;
}

/** Plain words for each kind of place. */
function wordsFor(snapshot: Snapshot, counts: { present: number; people: number; total: number }): Words {
  const ctx = snapshot.context;
  const people = snapshot.people.filter((p) => !p.withdrawn);
  if (ctx.type === 'meal') {
    return {
      not: 'Not eaten yet',
      notCount: counts.total - counts.present,
      done: 'Eaten',
      doneCount: counts.present,
      notShort: 'Not yet',
      action: 'Served',
      ask: (n) => `Mark ${n} as served?`,
      count: (d, t) => `${d} of ${t} eaten`,
      allDone: 'Everyone has eaten.',
      noneDone: 'No one has eaten yet.',
    };
  }
  if (ctx.type === 'site') {
    return {
      not: 'Not arrived yet',
      notCount: counts.total - counts.people,
      done: 'Arrived',
      doneCount: counts.people,
      notShort: 'Not arrived',
      action: 'Arrived',
      ask: (n) => `Mark ${n} as arrived?`,
      count: () => `${counts.present} on site`,
      allDone: 'Everyone has arrived.',
      noneDone: 'No one has arrived yet.',
    };
  }
  const booked = people.filter((p) => p.booked).length;
  const bookedDone = people.filter((p) => p.booked && (p.state?.visits ?? 0) > 0).length;
  return {
    not: booked > 0 ? 'Not here yet' : 'Not checked in',
    // Bookings: who's booked and not here. Otherwise everyone who hasn't come.
    notCount: booked > 0 ? Math.max(booked - bookedDone, 0) : counts.total - counts.people,
    done: 'Checked in',
    doneCount: counts.people,
    notShort: booked > 0 ? 'Not here' : 'Not yet',
    action: 'Check in',
    ask: (n) => `Check in ${n}?`,
    count: (d) => (booked > 0 ? `${d} of ${booked} here` : `${d} checked in`),
    allDone: booked > 0 ? 'Everyone booked is here.' : 'Everyone has checked in.',
    noneDone: 'No one has checked in yet.',
  };
}

/**
 * Who still needs to come, and who has: search, then a big button on each
 * name. Built from the list saved on this phone plus its own scans, so it
 * works with no signal.
 */
function PeopleList({
  snapshot,
  states,
  words,
  onCheckIn,
  onUndo,
  onTypeCode,
}: {
  snapshot: Snapshot;
  states: Map<string, PersonState>;
  words: Words;
  onCheckIn: (p: SnapshotPerson) => void;
  onUndo?: (p: SnapshotPerson) => void;
  onTypeCode: () => void;
}) {
  const ctx = snapshot.context;
  const [show, setShow] = useState<'not' | 'done'>('not');
  const [q, setQ] = useState('');
  const people = snapshot.people.filter((p) => !p.withdrawn);
  const bookings = ctx.type === 'activity' && people.some((p) => p.booked);
  const isDone = (p: SnapshotPerson) => (states.get(p.id)?.visits ?? 0) > 0;
  const done = people.filter(isDone);
  const notYet = people.filter((p) => !isDone(p) && (!bookings || p.booked));
  const name = (p: SnapshotPerson) => p.fullName ?? p.name;
  const searching = q.trim() !== '';
  // Searching looks through everyone, so a walk-in who didn't book can still be found.
  const list = (searching ? people : show === 'done' ? done : notYet)
    .filter((p) => matchesSearch(q, name(p), p.memberNumber))
    .sort((a, b) =>
      searching
        ? searchRank(q, name(a)) - searchRank(q, name(b)) || name(a).localeCompare(name(b))
        : show === 'done'
          ? (states.get(b.id)?.lastAcceptedAt ?? '').localeCompare(states.get(a.id)?.lastAcceptedAt ?? '')
          : name(a).localeCompare(name(b)),
    )
    .slice(0, searching ? 40 : undefined);
  const status = (p: SnapshotPerson) => {
    const s = states.get(p.id);
    if (!s?.lastAcceptedAt) return null;
    const at = clock(s.lastAcceptedAt);
    if (ctx.type === 'site' || (ctx.rules.type === 'activity' && ctx.rules.trackSignOut)) return `${s.present ? (ctx.type === 'site' ? 'On site' : 'Here') : 'Left'} · ${at}`;
    return at;
  };
  return (
    <div className="scanner-people">
      {/* They opened the list to find someone or see who's missing: the box is right there, but no keyboard until they tap it. */}
      <SearchField id="people-q" label="Search for a name" value={q} onChange={setQ} />
      {!searching && (
        <Segmented
          block
          label="Show"
          value={show}
          onChange={setShow}
          options={[
            { value: 'not', label: `${words.notShort} (${notYet.length})` },
            { value: 'done', label: `${words.done} (${done.length})` },
          ]}
        />
      )}
      {list.length === 0 ? (
        <p className="scanner-people-empty">{searching ? `No one called "${q}" is on this list.` : show === 'not' ? words.allDone : words.noneDone}</p>
      ) : (
        <ul className="scanner-people-list">
          {list.map((p) => {
            const here = isDone(p);
            const st = here ? status(p) : null;
            return (
              <li key={p.id} className={here ? 'scanner-person is-done' : 'scanner-person'}>
                <span className="scanner-person-main">
                  <span className="scanner-person-name">{name(p)}</span>
                  <span className="scanner-person-meta">{[p.group, st].filter(Boolean).join(' · ')}</span>
                  {ctx.type === 'meal' && p.dietaryAlert && (
                    <span>
                      <Badge tone="error">{isAllergy(p.dietaryAlert) ? 'Allergy' : 'Dietary needs'}</Badge>
                    </span>
                  )}
                </span>
                {!here ? (
                  <Button kind="primary" className="scanner-person-btn" onClick={() => onCheckIn(p)} aria-label={`${words.action}: ${name(p)}`}>
                    {words.action}
                  </Button>
                ) : onUndo ? (
                  <Button className="scanner-person-btn" onClick={() => onUndo(p)} aria-label={`Undo: ${name(p)}`}>
                    Undo
                  </Button>
                ) : (
                  <Icon name="check" size={24} label={words.done} />
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Button kind="ghost" onClick={onTypeCode}>
        <Icon name="keyboard" />
        Type the code from a card
      </Button>
    </div>
  );
}

/** The 8-character code printed under each lanyard's QR, for when the camera won't read it. */
function CodeEntry({ onCode }: { onCode: (code: string) => void }) {
  const [code, setCode] = useState('');
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
      <Button type="submit" kind="primary" block disabled={code.replace(/-/g, '').length !== 8}>
        Record
      </Button>
    </form>
  );
}
