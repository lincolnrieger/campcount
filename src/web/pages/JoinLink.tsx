import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams } from 'react-router';
import type { LinkFeature } from '../../shared/participantLinks';
import { ApiFailure, api } from '../api';
import { useTitle } from '../shell';
import { Button, Field, Icon, formatDateRange } from '../ui';
import type { SignupView } from '../components/SignupPanel';
import { ParticipantPage } from './Participant';
import { usePerson } from './Signup';

interface LinkInfo {
  event: { name: string; timezone: string; startsOn: string; endsOn: string; contactEmail: string; banner: { url: string; width: number; height: number } | null };
  features: LinkFeature[];
}

const WHAT: Record<LinkFeature, string> = {
  programme: 'see the camp programme',
  book: 'book your activities',
  teams: 'make or join a team',
  food: 'see what’s on the menu',
};

/** "book your activities, see the programme and see what's on the menu" */
function sentence(features: LinkFeature[]) {
  const parts = features.map((f) => WHAT[f]);
  return parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * A link for everyone, emailed before camp (/p/<code>). Type a membership
 * number and your camp page opens, with only the parts the link switches on.
 * Anyone could type a number, so the page leaves out surnames, groups,
 * team-mates and dietary details. The page is kept for this browser tab
 * only, so a refresh doesn't ask again but a shared computer forgets.
 */
export function JoinLink() {
  const { code } = useParams() as { code: string };
  const saved = `cc-p-${code}`;
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [missing, setMissing] = useState(false);
  const [number, setNumber] = useState('');
  const [opening, setOpening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timedOut = useCallback(() => {
    // usePerson has already closed the page.
    sessionStorage.removeItem(saved);
    setError(null);
    setProblem('For your privacy the page closes after a while. Type your number again.');
  }, [saved]);
  const person = usePerson(setError, timedOut);
  const { setView, view } = person;
  const close = () => {
    sessionStorage.removeItem(saved);
    setView(null);
    setError(null);
    setProblem(null);
  };
  useTitle(info ? info.event.name : 'My camp');

  useEffect(() => {
    api<LinkInfo>(`/public/signup/p/${code}`)
      .then(setInfo)
      .catch(() => setMissing(true));
    // Back after a refresh: reopen from the saved pass.
    const pass = sessionStorage.getItem(saved);
    if (pass)
      api<SignupView>('/public/signup/view', { body: { pass } })
        .then(setView)
        .catch(() => sessionStorage.removeItem(saved));
  }, [code, saved, setView]);

  // Keep the newest pass (each answer brings a fresh one).
  useEffect(() => {
    if (view) sessionStorage.setItem(saved, view.pass);
  }, [view, saved]);

  async function open(e: FormEvent) {
    e.preventDefault();
    if (!number.trim()) return;
    setOpening(true);
    setProblem(null);
    try {
      setView(await api<SignupView>(`/public/signup/p/${code}`, { body: { memberNumber: number.trim() } }));
      setNumber('');
      window.scrollTo({ top: 0 });
    } catch (err) {
      setProblem(err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.');
    } finally {
      setOpening(false);
    }
  }

  if (view) {
    const first: 'book' | 'day' | 'teams' | 'food' = info?.features[0] === 'programme' ? 'day' : (info?.features[0] ?? 'day');
    return <ParticipantPage view={view} busy={person.busy} actions={person} error={error} notice={null} initialTab={first} onNotMe={() => close()} />;
  }

  const banner = info?.event.banner;
  return (
    <main className="public" id="main">
      <div className="public-card book-link join-link">
        {missing ? (
          <>
            <h1>This link isn’t working</h1>
            <p className="meta">It may be old or switched off. Ask your leader for the latest link.</p>
          </>
        ) : !info ? (
          <p className="meta" role="status">
            Loading…
          </p>
        ) : (
          <>
            {banner ? (
              <img className="join-banner" src={banner.url} width={banner.width} height={banner.height} alt={info.event.name} />
            ) : (
              <h1>{info.event.name}</h1>
            )}
            <p className="meta">{formatDateRange(info.event.startsOn, info.event.endsOn)}</p>
            <p className="join-lead">Type your membership number to {sentence(info.features)}.</p>
            <form onSubmit={open} className="form" noValidate>
              <Field id="join-number" label="Scouts SA Membership Number">
                <input
                  className="input book-link-input"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={24}
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  aria-describedby={problem ? 'join-problem' : undefined}
                />
              </Field>
              <Button type="submit" kind="primary" busy={opening} busyLabel="Opening…" disabled={!number.trim()}>
                Open my camp page
              </Button>
            </form>
            {problem && (
              <p id="join-problem" className="book-link-result is-error" role="alert">
                <Icon name="error" size={20} />
                {problem}
              </p>
            )}
            <p className="meta">Doing this for more than one person? Open each one, then tap “Not you?” at the bottom of the page.</p>
            {info.event.contactEmail && (
              <p className="meta">
                Questions or changes? Email <a href={`mailto:${info.event.contactEmail}`}>{info.event.contactEmail}</a>.
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
