import { useState } from 'react';
import { Link } from 'react-router';
import { ApiFailure, api } from '../api';
import { Icon } from '../components/Icon';
import { QrCode } from '../components/QrCode';
import { placesLeft } from '../components/SignupPanel';
import type { SignupSession } from '../components/SignupPanel';
import { Loading, Notice, Skeleton } from '../components/ui';
import { useApi } from '../useApi';
import { useEvent } from './EventLayout';
import { dayInZone, dayLabel, timeRange } from '../../shared/time';

interface SignupInfo {
  enabled: boolean;
  link: string;
  sessions: SignupSession[];
}

/** Every QR code an event uses, in one place: lanyards, the sign-up screen, session posters and stations. */
export function QrCodes() {
  const { event, can, reload: reloadEvent } = useEvent();
  const manage = can('activities.manage');
  const signup = useApi<SignupInfo>(manage ? `/events/${event.id}/signup` : null);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'stop'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const tz = event.timezone;

  async function act(action: () => Promise<unknown>, ok: string) {
    try {
      await action();
      setMessage({ tone: 'ok', text: ok });
      await signup.reload();
    } catch (err) {
      setMessage({ tone: 'stop', text: err instanceof ApiFailure ? err.message : 'Something went wrong.' });
    }
  }

  const sessions = signup.data?.sessions ?? [];
  const chosen = sessions.filter((s) => !picked || picked.has(s.id));
  const when = (s: SignupSession) => (s.startsAt ? `${dayLabel(dayInZone(s.startsAt, tz), 'long')}, ${timeRange(s.startsAt, s.endsAt, tz)}` : 'Any time');

  return (
    <div className="qr-page">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <section className="list-section no-print">
        <h2 className="list-heading">Lanyards</h2>
        <div className="list-pad">
          <p>
            Everyone's QR code is on their lanyard. Scanning your own lanyard with a phone camera opens your activities page, where you can
            see and change your bookings.
          </p>
          {can('credentials.manage') && (
            <Link to="../lanyards" relative="path" className="btn btn-small">
              Print lanyards
            </Link>
          )}
        </div>
      </section>

      {manage && (
        <section className="list-section no-print">
          <h2 className="list-heading">Activity sign-up screen</h2>
          {signup.loading && !signup.data && (
            <Loading label="Loading sign-up screen">
              <Skeleton width="100%" height="15rem" radius="var(--radius)" />
            </Loading>
          )}
          {signup.data && !signup.data.enabled && (
            <div className="list-pad">
              <p>Let people book activity sessions themselves by scanning their lanyard at a tablet, or from a session poster.</p>
              {can('event.configure') && (
                <button
                  className="btn btn-small"
                  onClick={() =>
                    void act(async () => {
                      await api(`/events/${event.id}`, { method: 'PATCH', body: { features: { selfSignup: true } } });
                      await reloadEvent();
                    }, 'Activity sign-up is on. Choose which sessions people can book on the Activities tab.')
                  }
                >
                  Turn on activity sign-up
                </button>
              )}
            </div>
          )}
          {signup.data?.enabled && (
            <div className="list-pad share-box">
              <div className="poster">
                <p className="poster-title">Activity sign-up</p>
                <div className="poster-qr">
                  <QrCode value={signup.data.link} size="100%" label="Sign-up screen QR code" />
                </div>
              </div>
              <div className="share-actions">
                <p className="flush">
                  Open this on a tablet at camp HQ. People scan their lanyard (or type its code) and book. It goes back to the start after 90
                  seconds.
                </p>
                <input className="input input-compact link-share-input" readOnly value={signup.data.link} onFocus={(e) => e.target.select()} aria-label="Sign-up screen link" />
                <div className="actions flush-top">
                  <a className="btn btn-small" href={signup.data.link} target="_blank" rel="noreferrer">
                    Open sign-up screen<span className="visually-hidden"> (opens in a new tab)</span>
                  </a>
                  <button className="btn btn-secondary btn-small" onClick={() => void navigator.clipboard?.writeText(signup.data!.link).then(() => setCopied(true))}>
                    {copied ? 'Copied' : 'Copy link'}
                  </button>
                  <button
                    className="btn-link"
                    onClick={() => {
                      if (window.confirm('Make a new link? The current link, open sign-up screens and printed posters stop working.'))
                        void act(() => api(`/events/${event.id}/signup/new-link`, { body: {} }), 'New link made. Reprint any posters.');
                    }}
                  >
                    New link
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {manage && signup.data?.enabled && (
        <section className="list-section">
          <div className="section-row no-print">
            <h2 className="list-heading">Session posters</h2>
            {chosen.length > 0 && (
              <button className="btn btn-small" onClick={() => window.print()}>
                <Icon name="print" size={18} /> Print {chosen.length} poster{chosen.length === 1 ? '' : 's'}
              </button>
            )}
          </div>
          {sessions.length === 0 ? (
            <p className="field-hint no-print">
              No sessions are open for sign-up yet. On the <Link to="../activities" relative="path">Activities</Link> tab, edit a session and tick
              "People can sign up".
            </p>
          ) : (
            <>
              <p className="field-hint no-print">
                Put a poster at each activity. Scanning it opens the sign-up page with that session chosen; they then scan or type their lanyard
                code to book.
              </p>
              <ul className="list no-print">
                {sessions.map((s) => (
                  <li key={s.id}>
                    <label className="list-row poster-pick">
                      <input
                        type="checkbox"
                        checked={!picked || picked.has(s.id)}
                        onChange={(e) => {
                          const next = new Set(picked ?? sessions.map((x) => x.id));
                          if (e.target.checked) next.add(s.id);
                          else next.delete(s.id);
                          setPicked(next);
                        }}
                      />
                      <span className="list-main">
                        <strong>{s.name}</strong>
                        <span>
                          {when(s)}
                          {s.location && `, ${s.location}`}
                        </span>
                      </span>
                      <span className="tag tag-places">{placesLeft(s)}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="session-posters">
                {chosen.map((s) => (
                  <article key={s.id} className="session-poster">
                    <p className="session-poster-event">{event.name}</p>
                    <h3>{s.name}</h3>
                    <p className="session-poster-when">
                      {when(s)}
                      {s.location && <br />}
                      {s.location}
                    </p>
                    <div className="session-poster-qr">
                      <QrCode value={`${signup.data!.link}?activity=${s.id}`} size="100%" label={`Sign up for ${s.name}`} />
                    </div>
                    <p className="session-poster-cta">Scan to sign up, then scan your lanyard</p>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      <section className="list-section no-print">
        <h2 className="list-heading">Scanning</h2>
        <div className="list-pad">
          <p>
            Leaders scan from the <Link to="/scan">Scan</Link> tab on their own phone. For a shared phone or tablet that only scans one thing
            (like the meal hall), set up a station on the <Link to="../stations" relative="path">Stations</Link> tab: it shows a pairing QR code
            to scan on that device.
          </p>
        </div>
      </section>
    </div>
  );
}
