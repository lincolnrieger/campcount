import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams } from 'react-router';
import type { LinkFeature } from '../../shared/participantLinks';
import { ApiFailure, api } from '../api';
import { useTitle } from '../shell';
import { Icon } from '../ui';
import type { SignupView } from '../components/SignupPanel';
import { ParticipantPage } from './Participant';
import { usePerson } from './Signup';

interface LinkInfo {
  event: { name: string; timezone: string; startsOn: string; endsOn: string; contactEmail: string; banner: { url: string; width: number; height: number } | null };
  features: LinkFeature[];
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
            <header className="join-head">
              <h1>{info.event.name}</h1>
              <p>Open your camp page</p>
            </header>
            <form onSubmit={open} noValidate>
              <label htmlFor="join-number" className="field-label">
                Scouts SA Membership Number
              </label>
              <div className="join-row">
                <input
                  id="join-number"
                  className="input book-link-input"
                  inputMode="numeric"
                  enterKeyHint="go"
                  autoComplete="off"
                  maxLength={24}
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  aria-describedby={problem ? 'join-problem' : undefined}
                />
                <button type="submit" className="join-go" disabled={!number.trim() || opening} aria-label={opening ? 'Opening' : 'Open my camp page'}>
                  <Icon name={opening ? 'sync' : 'chevron'} size={24} />
                </button>
              </div>
            </form>
            {problem && (
              <p id="join-problem" className="book-link-result is-error" role="alert">
                <Icon name="error" size={20} />
                {problem}
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
