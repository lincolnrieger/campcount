import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import type { ContextType, Direction } from '../../shared/scanRules';
import { Notice } from '../components/ui';
import { api } from '../api';
import { matchesSearch, searchRank } from '../../shared/search';
import { useSyncStatus } from '../offline/sync';
import { createDetector } from '../scan/decoder';
import type { Feedback, ScanInput, SnapshotPerson } from '../scan/useScanSession';
import { useScanSession } from '../scan/useScanSession';

const SAME_CODE_COOLDOWN_MS = 3000;

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

function SyncChip() {
  const s = useSyncStatus();
  const time = s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Adelaide' }) : null;
  let text: string;
  let cls = 'sync-ok';
  if (s.state === 'blocked') {
    text = s.message ?? 'Upload blocked';
    cls = 'sync-stop';
  } else if (s.pending > 0) {
    text = `${s.pending} waiting to upload${s.state === 'offline' ? ', no signal' : ''}`;
    cls = 'sync-warn';
  } else if (s.state === 'offline') {
    text = 'No signal. Scans are saved on this phone';
    cls = 'sync-warn';
  } else {
    text = time ? `All uploaded ${time}` : 'All uploaded';
  }
  return (
    <p className={`sync-chip ${cls}`} role="status" aria-live="polite">
      <span aria-hidden="true" className="sync-dot" />
      {text}
    </p>
  );
}

function ResultPanel({ feedback, contextType }: { feedback: Feedback | null; contextType: ContextType }) {
  if (!feedback) {
    return (
      <div className="result result-idle" aria-live="assertive">
        <p className="result-title">Ready to scan</p>
        <p className="result-meta">Hold a lanyard QR code inside the frame.</p>
      </div>
    );
  }
  const p = feedback.person;
  const icon = { ok: '✓', warn: '!', stop: '×' }[feedback.tone];
  return (
    <div className={`result result-${feedback.tone}`} aria-live="assertive" aria-atomic="true">
      <div className="result-head">
        <span className="result-icon" aria-hidden="true">
          {icon}
        </span>
        <p className="result-title">{feedback.title}</p>
      </div>
      {p && <p className="result-name">{p.fullName ?? p.name}</p>}
      {p && (
        <p className="result-meta">
          {p.group}, member {p.memberNumber}
        </p>
      )}
      {feedback.message && <p className="result-message">{feedback.message}</p>}
      {feedback.warning && <p className="result-message">{feedback.warning}</p>}
      {p?.noPhotos && <p className="flag flag-photo">No photos</p>}
      {contextType === 'meal' && p?.dietaryAlert && (
        <div className={`flag ${/allergy/i.test(p.dietaryAlert) ? 'flag-allergy' : 'flag-diet'}`}>
          <strong>Dietary:</strong> {p.dietaryAlert}
          <span className="flag-note">Check the meal yourself. A scan does not confirm the food is safe.</span>
        </div>
      )}
    </div>
  );
}

export function Scan() {
  const { eventId, type, contextId } = useParams() as { eventId: string; type: ContextType; contextId?: string };
  const session = useScanSession(eventId, type, contextId ?? null);
  const rules = session.snapshot?.context.rules;
  const twoWay = rules?.type === 'site' || (rules?.type === 'activity' && rules.trackSignOut);
  const [direction, setDirection] = useState<Direction>('in');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [camera, setCamera] = useState<'off' | 'starting' | 'on' | 'denied' | 'unavailable'>('off');
  const [sound, setSound] = useState(true);
  const [panel, setPanel] = useState<'none' | 'code' | 'name' | 'eaten'>('none');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastCode = useRef<{ value: string; at: number } | null>(null);
  const recordRef = useRef<(input: ScanInput) => Promise<void>>(async () => undefined);

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

  if (session.loadError) {
    return (
      <div className="scan">
        <Notice tone="stop">{session.loadError}</Notice>
        <Link to={`/events/${eventId}`}>Back to event</Link>
      </div>
    );
  }
  if (!session.snapshot) return <p className="lede">Downloading the list for this phone…</p>;
  const ctx = session.snapshot.context;

  return (
    <div className="scan">
      <header className="scan-head">
        <div>
          <h1 className="scan-title">{ctx.name}</h1>
          <p className="field-hint flush">{session.snapshot.event.name}</p>
        </div>
        <SyncChip />
      </header>
      {session.fromCache && (
        <Notice tone="warn">
          <p>Using the list saved on this phone. Scans made on other phones will show up once you have signal.</p>
        </Notice>
      )}

      {twoWay && (
        <div className="direction" role="radiogroup" aria-label="Scan direction">
          {(['in', 'out'] as Direction[]).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={direction === d}
              className={direction === d ? 'is-on' : undefined}
              onClick={() => setDirection(d)}
            >
              {ctx.type === 'site' ? (d === 'in' ? 'Arriving' : 'Leaving') : d === 'in' ? 'Signing in' : 'Signing out'}
            </button>
          ))}
        </div>
      )}

      <div className={`viewfinder ${camera === 'on' ? 'is-live' : ''}`}>
        <video ref={videoRef} playsInline muted aria-hidden="true" />
        {camera !== 'on' && (
          <div className="viewfinder-cover">
            {camera === 'denied' ? (
              <p>
                Camera access is blocked. Allow the camera for this site in your browser settings, or type the code from the lanyard below.
              </p>
            ) : camera === 'unavailable' ? (
              <p>This browser can't use the camera. Type the code from the lanyard below.</p>
            ) : (
              <button className="btn" onClick={() => void startCamera()} disabled={camera === 'starting'}>
                {camera === 'starting' ? 'Starting camera…' : 'Start camera'}
              </button>
            )}
          </div>
        )}
        {camera === 'on' && <span className="viewfinder-guide" aria-hidden="true" />}
      </div>

      <ResultPanel feedback={feedback} contextType={ctx.type} />

      <div className="scan-counts" aria-live="polite">
        {ctx.type === 'meal' ? (
          <p>
            <strong>{counts.present}</strong> served of {counts.total}
          </p>
        ) : (
          <>
            {twoWay && (
              <p>
                <strong>{counts.present}</strong> {ctx.type === 'site' ? 'on site now' : 'signed in now'}
              </p>
            )}
            <p>
              <strong>{counts.people}</strong> {ctx.type === 'site' ? 'arrived' : 'people so far'}
            </p>
          </>
        )}
      </div>

      <div className="scan-tools">
        <button type="button" className="btn btn-secondary" aria-expanded={panel === 'code'} onClick={() => setPanel(panel === 'code' ? 'none' : 'code')}>
          Type a code
        </button>
        <button type="button" className="btn btn-secondary" aria-expanded={panel === 'name'} onClick={() => setPanel(panel === 'name' ? 'none' : 'name')}>
          Find by name
        </button>
        {ctx.type === 'meal' && (
          <button type="button" className="btn btn-secondary" aria-expanded={panel === 'eaten'} onClick={() => setPanel(panel === 'eaten' ? 'none' : 'eaten')}>
            Who's eaten
          </button>
        )}
        {camera === 'on' && (
          <button type="button" className="btn btn-secondary" onClick={stopCamera}>
            Stop camera
          </button>
        )}
      </div>
      {panel === 'code' && <CodeEntry onSubmit={(code) => void record({ kind: 'code', code })} />}
      {panel === 'eaten' && ctx.type === 'meal' && ctx.id && <WhoHasEaten eventId={eventId} mealId={ctx.id} refreshKey={session.entries.length} />}
      {panel === 'name' && (
        <NameSearch
          people={session.snapshot.people}
          onPick={(p) => {
            if (window.confirm(`Record ${p.fullName ?? p.name} (${p.group}) without their card?`)) void record({ kind: 'manual', registrationId: p.id });
          }}
        />
      )}

      <details className="section-gap">
        <summary>This phone's recent scans</summary>
        <ol className="recent">
          {[...session.entries]
            .reverse()
            .slice(0, 15)
            .map((e) => {
              const person = e.registrationId ? session.snapshot!.people.find((p) => p.id === e.registrationId) : null;
              const result = e.server ?? e.local;
              return (
                <li key={e.id}>
                  <span>{new Date(e.createdAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Adelaide' })}</span>
                  <strong>{person?.name ?? 'Unknown card'}</strong>
                  <span>{result.outcome === 'accepted' ? result.message : result.message}</span>
                  <span className="field-hint">{e.synced ? 'Uploaded' : 'Waiting'}</span>
                </li>
              );
            })}
        </ol>
      </details>

      <label className="check">
        <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} />
        <div>
          <strong>Beep on scan</strong>
          <span>Different tones for OK, check and problem. The phone also vibrates.</span>
        </div>
      </label>
    </div>
  );
}

function CodeEntry({ onSubmit }: { onSubmit: (code: string) => void }) {
  const [code, setCode] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit(code);
    setCode('');
  }
  return (
    <form className="scan-panel" onSubmit={submit}>
      <label htmlFor="typed-code">Code printed under the QR</label>
      <div className="inline-form">
        <input
          id="typed-code"
          className="input input-code"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={9}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="K7QM-3XRP"
        />
        <button className="btn" disabled={code.replace(/-/g, '').length !== 8}>
          Record
        </button>
      </div>
    </form>
  );
}

function NameSearch({ people, onPick }: { people: SnapshotPerson[]; onPick: (p: SnapshotPerson) => void }) {
  const [q, setQ] = useState('');
  const matches = q.trim()
    ? people
        .filter((p) => matchesSearch(q, p.fullName ?? p.name, p.memberNumber))
        .sort((a, b) => searchRank(q, a.fullName ?? a.name) - searchRank(q, b.fullName ?? b.name) || (a.fullName ?? a.name).localeCompare(b.fullName ?? b.name))
        .slice(0, 30)
    : [];
  return (
    <div className="scan-panel">
      <label htmlFor="name-q">Name or membership number</label>
      <input id="name-q" className="input" type="search" autoComplete="off" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Start typing, even one letter" />
      <p className="field-hint">For when a card won't scan. It's saved as a manual entry.</p>
      <ul className="name-results">
        {matches.map((p) => (
          <li key={p.id}>
            <button type="button" className="name-result" onClick={() => onPick(p)}>
              <strong>{p.fullName ?? p.name}</strong>
              <span>{p.group}</span>
            </button>
          </li>
        ))}
      </ul>
      {q.trim() && matches.length === 0 && <p className="field-hint">No one on this list matches "{q}".</p>}
    </div>
  );
}

/** For the meal team: who has and hasn't eaten yet at this meal. */
function WhoHasEaten({ eventId, mealId, refreshKey }: { eventId: string; mealId: string; refreshKey: number }) {
  const [data, setData] = useState<{ people: { id: string; name: string; group: string; servedAt: string | null }[] } | null>(null);
  const [show, setShow] = useState<'not' | 'eaten'>('not');
  const [q, setQ] = useState('');
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    api<{ people: { id: string; name: string; group: string; servedAt: string | null }[] }>(`/events/${eventId}/meals/${mealId}/served`)
      .then((d) => {
        setData(d);
        setOffline(false);
      })
      .catch(() => setOffline(true));
  }, [eventId, mealId, refreshKey]);
  if (!data) return <p className="field-hint">{offline ? 'Needs signal to load the list.' : 'Loading…'}</p>;
  const eaten = data.people.filter((p) => p.servedAt);
  const notYet = data.people.filter((p) => !p.servedAt);
  const list = (show === 'eaten' ? eaten : notYet).filter((p) => matchesSearch(q, p.name));
  return (
    <div className="scan-panel">
      <div className="segmented" role="tablist" aria-label="Show">
        <button type="button" role="tab" aria-selected={show === 'not'} onClick={() => setShow('not')}>
          Not yet <span>{notYet.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={show === 'eaten'} onClick={() => setShow('eaten')}>
          Eaten <span>{eaten.length}</span>
        </button>
      </div>
      <input className="input section-gap-sm" type="search" aria-label="Search names" placeholder="Search names" value={q} onChange={(e) => setQ(e.target.value)} />
      {offline && <p className="field-hint">No signal: showing the last list loaded.</p>}
      <ul className="eaten-list">
        {list.map((p) => (
          <li key={p.id}>
            <span>
              <strong>{p.name}</strong>
              <span className="field-hint"> {p.group}</span>
            </span>
            {p.servedAt && (
              <span className="field-hint">
                {new Date(p.servedAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Adelaide' })}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
