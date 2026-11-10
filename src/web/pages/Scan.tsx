import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import type { ContextType, Direction, PersonState } from '../../shared/scanRules';
import { matchesSearch, searchRank } from '../../shared/search';
import { contextEntries } from '../offline/db';
import { syncNow, useSyncStatus } from '../offline/sync';
import { ApiFailure, api } from '../api';
import { createDetector } from '../scan/decoder';
import type { ScanTarget } from '../scan/targets';
import { isOnNow, useEventSummary, useScanTargets } from '../scan/targets';
import type { EventSummary } from '../types';
import { timeInZone, todayInZone } from '../../shared/time';
import type { Feedback, ScanInput, Snapshot, SnapshotPerson } from '../scan/useScanSession';
import { useScanSession } from '../scan/useScanSession';
import { useSession } from '../session';
import { useTitle } from '../shell';
import { Badge, Button, ButtonLink, Choice, Icon, IconButton, Loading, Notice, SearchField, Segmented, Sheet, Skeleton, SkeletonRows, useConfirm, useToast } from '../ui';
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
  const toast = useToast();
  const station = me?.kind === 'station';
  const eventSummary = useEventSummary(me?.kind === 'user' ? eventId : null);
  // People who only scan live in the scanner: no close button, their account is in the menu.
  const scanOnlyUser = me?.kind === 'user' && eventSummary !== null && scanOnly(eventSummary);
  useTitle(session.snapshot ? `Scan: ${session.snapshot.context.type === 'site' ? 'Gate' : session.snapshot.context.name}` : 'Scan');

  const [tab, setTab] = useState<'scan' | 'find' | 'list'>('scan');
  const [menuOpen, setMenuOpen] = useState(false);
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
  // The camera rests while Find or the list is open, and comes back with the scanner.
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

  /** Take someone off Eaten / Checked in, after their scan has reached the server. */
  const removePerson = async (p: SnapshotPerson) => {
    const ctx = session.snapshot?.context;
    if (!ctx || ctx.type === 'site' || !contextId) return;
    const name = p.fullName ?? p.name;
    const from = ctx.type === 'meal' ? 'Eaten' : 'Checked in';
    const ok = await confirm({
      title: `Remove ${name} from ${from}?`,
      body: <p>They go back to Not yet and can be scanned again. The scan stays in their history, marked as undone.</p>,
      confirm: 'Remove',
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
      toast(`${name} removed from ${from}`);
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
  // The running count, top right: big number, a few words under it.
  const count =
    ctx.type === 'meal'
      ? { value: counts.present, of: counts.total, words: 'served' }
      : ctx.type === 'site'
        ? { value: counts.present, of: counts.total, words: 'on site' }
        : { value: counts.people, of: null, words: 'checked in' };
  const listLabel = ctx.type === 'meal' ? 'Eaten' : ctx.type === 'site' ? 'On site' : 'Checked in';
  const listCount = ctx.type === 'meal' || ctx.type === 'site' ? counts.present : counts.people;
  const backToScan = () => setTab('scan');
  const openView = (v: 'find' | 'list') => {
    setMenuOpen(false);
    setTab(v);
  };
  const currentKey = ctx.type === 'site' ? 'site' : `${ctx.type}:${ctx.id}`;
  const switchTo = (t: ScanTarget) => {
    if (t.key === currentKey) return;
    resumeCamera = camera === 'on';
    stopCamera();
    navigate(t.to, { replace: true });
  };
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
          <IconButton label="Menu" aria-haspopup="dialog" onClick={() => setMenuOpen(true)}>
            <Icon name="more" size={24} />
          </IconButton>
        </header>

        {eventSummary && !station && <ScanPlaces event={eventSummary} currentKey={currentKey} onPick={switchTo} />}

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
                  <p>The camera is blocked. Allow it for this site in your browser's settings, or use Find someone in the menu.</p>
                ) : camera === 'unavailable' ? (
                  <p>This browser can't use the camera. Use Find someone in the menu instead.</p>
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

        {tab !== 'scan' && (
          <Button kind="primary" block onClick={backToScan}>
            <Icon name="scan" />
            Back to scanning
          </Button>
        )}

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

        {tab === 'list' && <WhoList snapshot={session.snapshot} states={session.states.map} onRemove={ctx.type === 'site' ? undefined : (p) => void removePerson(p)} />}
      </div>

      <Sheet open={menuOpen} title="Menu" onClose={() => setMenuOpen(false)}>
        <div className="scanner-menu">
          <ul className="list">
            <li>
              <button type="button" className="row row-button" onClick={() => openView('find')}>
                <Icon name="search" />
                <span className="row-main">
                  <span className="row-title">Find someone</span>
                  <span className="row-meta">By name, or the code on their card</span>
                </span>
                <Icon name="chevron" />
              </button>
            </li>
            <li>
              <button type="button" className="row row-button" onClick={() => openView('list')}>
                <Icon name="check" />
                <span className="row-main">
                  <span className="row-title">
                    {listLabel} <span className="num">({listCount})</span>
                  </span>
                  <span className="row-meta">{ctx.type === 'site' ? "Who has and hasn't arrived" : ctx.type === 'meal' ? "Who has and hasn't eaten. Remove someone here" : "Who has and hasn't checked in"}</span>
                </span>
                <Icon name="chevron" />
              </button>
            </li>
            {!station && (
              <li>
                <button type="button" className="row row-button" onClick={() => navigate(`/scan?event=${eventId}&pick=1`)}>
                  <Icon name="scan" />
                  <span className="row-main">
                    <span className="row-title">Everything you can scan</span>
                    <span className="row-meta">Other days and the full list</span>
                  </span>
                  <Icon name="chevron" />
                </button>
              </li>
            )}
          </ul>
          <Choice checked={sound} onChange={(e) => setSound(e.target.checked)} label="Beep on each scan" description="The phone also buzzes if it can." />
          {session.fromCache && <Notice tone="warning">Using the list saved on this phone. Scans from other phones show up once you have signal.</Notice>}
          <div className="scanner-menu-account">
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

/** Last list of places, so switching between them doesn't flash an empty row while the next scanner loads. */
let placesCache: { eventId: string; targets: ScanTarget[] } | null = null;

/**
 * Today's places to scan, always across the top of the scanner: one tap
 * switches, and the camera carries on. The full list is in the menu.
 */
function ScanPlaces({ event, currentKey, onPick }: { event: EventSummary; currentKey: string; onPick: (t: ScanTarget) => void }) {
  const loaded = useScanTargets(event).targets;
  const targets = loaded ?? (placesCache?.eventId === event.id ? placesCache.targets : null);
  useEffect(() => {
    if (loaded) placesCache = { eventId: event.id, targets: loaded };
  }, [loaded, event.id]);
  const currentRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [targets, currentKey]);
  if (!targets) return null;
  const today = todayInZone(event.timezone);
  const order = { site: 0, meal: 1, activity: 1 } as const;
  const shown = targets
    .filter((t) => t.key === currentKey || t.day === null || t.day === today)
    .sort((a, b) => order[a.type] - order[b.type] || (a.startsAt ?? '￿').localeCompare(b.startsAt ?? '￿') || a.label.localeCompare(b.label));
  if (shown.length < 2) return null;
  // Same activity more than once today: tell the sessions apart by start time.
  const repeated = new Set(shown.map((t) => t.label).filter((l, i, all) => all.indexOf(l) !== i));
  return (
    <nav className="scan-places" aria-label="Places to scan">
      {shown.map((t) => {
        const current = t.key === currentKey;
        return (
          <button key={t.key} ref={current ? currentRef : undefined} type="button" className="scan-place" aria-current={current ? 'page' : undefined} onClick={() => onPick(t)}>
            {isOnNow(t) && !current && <span className="scan-place-dot" aria-hidden="true" />}
            {t.type === 'site' ? 'Gate' : t.label}
            {repeated.has(t.label) && t.startsAt && <span className="scan-place-time num">{timeInZone(t.startsAt, event.timezone)}</span>}
            {isOnNow(t) && <span className="visually-hidden"> (on now)</span>}
          </button>
        );
      })}
    </nav>
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
function WhoList({ snapshot, states, onRemove }: { snapshot: Snapshot; states: Map<string, PersonState>; onRemove?: (p: SnapshotPerson) => void }) {
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
                {onRemove && show === 'done' && (
                  <Button small kind="ghost" onClick={() => onRemove(p)} aria-label={`Remove ${name(p)}`}>
                    Remove
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
