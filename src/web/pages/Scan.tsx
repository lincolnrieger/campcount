import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import type { ContextType, Direction } from '../../shared/scanRules';
import { matchesSearch, searchRank } from '../../shared/search';
import { api } from '../api';
import { useSyncStatus } from '../offline/sync';
import { createDetector } from '../scan/decoder';
import { rememberLastScan, useEventSummary } from '../scan/targets';
import type { Feedback, ScanInput, SnapshotPerson } from '../scan/useScanSession';
import { useScanSession } from '../scan/useScanSession';
import { useSession } from '../session';
import { useTitle } from '../shell';
import { Button, Icon, IconButton, Loading, Menu, Notice, Progress, SearchField, Segmented, Sheet, Skeleton, SkeletonRows, useConfirm } from '../ui';
import { ScanSwitcher } from './ScanHub';

const SAME_CODE_COOLDOWN_MS = 3000;
const TZ = 'Australia/Adelaide';
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: TZ });

/** Set when switching what to scan, so the next scanner starts its camera straight away. */
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

/** Upload state for this phone: synced, waiting, offline or blocked. */
function SyncChip() {
  const s = useSyncStatus();
  let text: string;
  let tone: 'ok' | 'warn' | 'stop' = 'ok';
  let icon: 'sync' | 'offline' | 'warning' = 'sync';
  if (s.state === 'blocked') {
    text = s.message ?? 'Upload blocked';
    tone = 'stop';
    icon = 'warning';
  } else if (s.pending > 0) {
    text = `${s.pending} waiting to upload${s.state === 'offline' ? ' · no signal' : ''}`;
    tone = 'warn';
    icon = s.state === 'offline' ? 'offline' : 'sync';
  } else if (s.state === 'offline') {
    text = 'No signal · scans are saved on this phone';
    tone = 'warn';
    icon = 'offline';
  } else {
    text = s.lastSyncAt ? `All uploaded ${clock(s.lastSyncAt)}` : 'All uploaded';
  }
  return (
    <p className={`sync-chip sync-${tone}`} role="status">
      <Icon name={icon} size={16} />
      {text}
    </p>
  );
}

const RESULT_ICON = { ok: 'check', warn: 'warning', stop: 'cross' } as const;

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
      {(p?.noPhotos || (contextType === 'meal' && p?.dietaryAlert)) && (
        <div className="scan-flags">
          {p?.noPhotos && (
            <p className="scan-flag">
              <Icon name="eye" size={16} />
              No photos
            </p>
          )}
          {contextType === 'meal' && p?.dietaryAlert && (
            <p className={/allergy/i.test(p.dietaryAlert) ? 'scan-flag scan-flag-allergy' : 'scan-flag'}>
              <Icon name="warning" size={16} />
              <span>
                <strong>{/allergy/i.test(p.dietaryAlert) ? 'Allergy: ' : 'Dietary: '}</strong>
                {p.dietaryAlert.replace(/^allergy:\s*/i, '')}
                <span className="scan-flag-note"> Check the food yourself.</span>
              </span>
            </p>
          )}
        </div>
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
  const event = useEventSummary(me?.kind === 'user' ? eventId : null);
  const station = me?.kind === 'station';
  useTitle(session.snapshot ? `Scan: ${session.snapshot.context.type === 'site' ? 'Gate' : session.snapshot.context.name}` : 'Scan');

  const [switching, setSwitching] = useState(false);
  const [sheet, setSheet] = useState<'none' | 'name' | 'eaten'>('none');
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

  const currentKey = type === 'site' ? 'site' : `${type}:${contextId}`;
  const rules = session.snapshot?.context.rules;
  const twoWay = rules?.type === 'site' || (rules?.type === 'activity' && rules.trackSignOut);

  const record = useCallback(
    async (input: ScanInput) => {
      try {
        const result = await session.record(input, direction);
        setFeedback(result);
        signal(result.tone, sound);
      } catch {
        // A scan is already being processed, or the list is still loading.
      }
    },
    [session, direction, sound],
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
  const startRef = useRef(startCamera);
  useEffect(() => {
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
  }, []);
  const contextName = session.snapshot?.context.name;
  useEffect(() => {
    if (contextName && me?.kind === 'user') rememberLastScan({ eventId, to: location.pathname, label: contextName });
  }, [contextName, eventId, location.pathname, me?.kind]);
  // Warm the fallback decoder while online so the service worker caches it for offline use.
  useEffect(() => {
    void import('jsqr');
  }, []);

  const counts = useMemo(() => {
    const values = [...session.states.map.values()];
    return {
      present: session.states.presentNow,
      people: values.filter((s) => s.visits > 0).length,
      total: session.snapshot?.people.filter((p) => !p.withdrawn).length ?? 0,
    };
  }, [session.states, session.snapshot]);

  const close = () => {
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
  const progressValue = ctx.type === 'meal' ? counts.present : counts.people;
  const progressText =
    ctx.type === 'meal'
      ? `${counts.present} of ${counts.total} served`
      : ctx.type === 'site'
        ? `${counts.present} on site · ${counts.people} of ${counts.total} arrived`
        : `${counts.people} ${counts.people === 1 ? 'person' : 'people'} so far${twoWay ? ` · ${counts.present} here now` : ''}`;

  return (
    <div className="scanner">
      <div className="scanner-inner">
        <header className="scanner-head">
          {!station && (
            <IconButton label="Close scanner" onClick={close}>
              <Icon name="close" size={24} />
            </IconButton>
          )}
          <div className="scanner-title">
            <p className="scanner-event">{session.snapshot.event.name}</p>
            <h1>{ctx.type === 'site' ? 'Gate' : ctx.name}</h1>
          </div>
          <IconButton label={sound ? 'Beep on' : 'Beep off'} aria-pressed={sound} onClick={() => setSound(!sound)}>
            <Icon name={sound ? 'sound' : 'mute'} size={24} />
          </IconButton>
          {!station && event && (
            <Button small onClick={() => setSwitching(true)} aria-haspopup="dialog">
              Switch
            </Button>
          )}
        </header>
        <SyncChip />
        {event && <ScanSwitcher event={event} currentKey={currentKey} open={switching} onClose={() => setSwitching(false)} onSwitch={() => (resumeCamera = camera === 'on')} />}

        <div className="scanner-body">
          <div className="scanner-camera">
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
                    <p>The camera is blocked. Allow it for this site in your browser's settings, or use Find by name.</p>
                  ) : camera === 'unavailable' ? (
                    <p>This browser can't use the camera. Use Find by name instead.</p>
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
            {session.fromCache && <p className="scanner-note">Using the list saved on this phone. Scans from other phones show up once you have signal.</p>}
          </div>

          <div className="scanner-side">
            <ScanResult feedback={feedback} contextType={ctx.type} />
            <div className="scanner-progress">
              <p className="num">{progressText}</p>
              {counts.total > 0 && ctx.type !== 'activity' && <Progress value={progressValue} max={counts.total} />}
            </div>
            <div className="scanner-actions">
              <Button block onClick={() => setSheet('name')}>
                <Icon name="search" />
                Find by name
              </Button>
              {ctx.type === 'meal' && (
                <Button block onClick={() => setSheet('eaten')}>
                  Who hasn't eaten
                </Button>
              )}
              {camera === 'on' && (
                <Button block kind="ghost" onClick={stopCamera}>
                  Stop camera
                </Button>
              )}
            </div>
            {session.entries.length > 0 && (
              <section className="scanner-recent" aria-labelledby="recent-heading">
                <h2 id="recent-heading">Last scans</h2>
                <ol>
                  {[...session.entries]
                    .reverse()
                    .slice(0, 5)
                    .map((e) => {
                      const person = e.registrationId ? session.snapshot!.people.find((p) => p.id === e.registrationId) : null;
                      const result = e.server ?? e.local;
                      return (
                        <li key={e.id} className={result.outcome === 'accepted' ? undefined : 'is-problem'}>
                          <span className="num">{clock(e.createdAt)}</span>
                          <strong>{person?.fullName ?? person?.name ?? 'Unknown card'}</strong>
                          <span>
                            {result.outcome === 'accepted' ? '' : <Icon name="warning" size={16} />}
                            {result.message}
                            {e.synced ? '' : ' · waiting'}
                          </span>
                        </li>
                      );
                    })}
                </ol>
              </section>
            )}
            {station && (
              <div className="scanner-station">
                <Menu label="Station options" items={[{ label: 'Unpair this device', onSelect: () => void signOut(), danger: true }]} />
              </div>
            )}
          </div>
        </div>
      </div>

      <Sheet open={sheet === 'name'} title="Find by name" onClose={() => setSheet('none')}>
        <FindByName
          people={session.snapshot.people}
          onCode={(code) => {
            setSheet('none');
            void record({ kind: 'code', code });
          }}
          onPick={async (p) => {
            const name = p.fullName ?? p.name;
            setSheet('none');
            const ok = await confirm({
              title: `Record ${name}?`,
              body: <p>{p.group}. This is saved as a hand entry, without their card.</p>,
              confirm: 'Record',
            });
            if (ok) void record({ kind: 'manual', registrationId: p.id });
          }}
        />
      </Sheet>
      {ctx.type === 'meal' && ctx.id && (
        <Sheet open={sheet === 'eaten'} title="Who hasn't eaten" onClose={() => setSheet('none')}>
          <WhoHasEaten eventId={eventId} mealId={ctx.id} refreshKey={session.entries.length} />
        </Sheet>
      )}
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

/** For the meal team: who has and hasn't eaten at this meal. Needs signal. */
function WhoHasEaten({ eventId, mealId, refreshKey }: { eventId: string; mealId: string; refreshKey: number }) {
  type Row = { id: string; name: string; group: string; servedAt: string | null };
  const [data, setData] = useState<{ people: Row[] } | null>(null);
  const [show, setShow] = useState<'not' | 'eaten'>('not');
  const [q, setQ] = useState('');
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    api<{ people: Row[] }>(`/events/${eventId}/meals/${mealId}/served`)
      .then((d) => {
        setData(d);
        setOffline(false);
      })
      .catch(() => setOffline(true));
  }, [eventId, mealId, refreshKey]);
  if (!data)
    return offline ? (
      <Notice tone="warning">
        <p>This list needs signal. Scanning still works without it.</p>
      </Notice>
    ) : (
      <Loading what="who has eaten" rows={5} />
    );
  const eaten = data.people.filter((p) => p.servedAt);
  const notYet = data.people.filter((p) => !p.servedAt);
  const list = (show === 'eaten' ? eaten : notYet).filter((p) => matchesSearch(q, p.name));
  return (
    <>
      <Segmented
        block
        label="Show"
        value={show}
        onChange={setShow}
        options={[
          { value: 'not', label: `Not yet (${notYet.length})` },
          { value: 'eaten', label: `Eaten (${eaten.length})` },
        ]}
      />
      <SearchField id="eaten-q" label="Search names" value={q} onChange={setQ} />
      {offline && <p className="meta">No signal: showing the last list loaded.</p>}
      {list.length === 0 ? (
        <p className="meta">{show === 'not' ? 'Everyone has eaten.' : 'No one yet.'}</p>
      ) : (
        <ul className="list">
          {list.map((p) => (
            <li key={p.id} className="row">
              <span className="row-main">
                <span className="row-title">{p.name}</span>
                <span className="row-meta">{p.group}</span>
              </span>
              {p.servedAt && <span className="meta num">{clock(p.servedAt)}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
