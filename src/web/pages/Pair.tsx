import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ApiFailure, api } from '../api';
import { useSession } from '../session';
import { useTitle } from '../shell';
import { useSiteEvent } from '../site';
import { BrandMark } from '../ui/AppShell';
import { SiteLogo } from '../ui/SiteShell';
import { Button, Field } from '../ui';

/** Turn this device into a station. The code can also arrive in the URL fragment from the pairing QR. */
export function Pair() {
  useTitle('Set up a scanning station');
  const { refresh } = useSession();
  const navigate = useNavigate();
  const siteEvent = useSiteEvent();
  const [code, setCode] = useState(() => window.location.hash.slice(1).toUpperCase());
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (code.replace(/-/g, '').length !== 8) {
      setError('Enter the 8-character code, like K7QM-3XRP');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await api('/stations/pair', { body: { code } });
      history.replaceState(null, '', '/pair');
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.');
      setBusy(false);
    }
  }

  return (
    <main className="public" id="main">
      <div className="public-card">
        <p className="public-brand">
          {siteEvent ? <SiteLogo size={32} /> : <BrandMark size={32} />}
          <span>{siteEvent?.name ?? 'CampCount'}</span>
        </p>
        <div className="stack">
          <h1>Set up this device as a scanning station</h1>
          <p className="meta">Enter the pairing code from the event manager's screen. This device will then only scan for one thing.</p>
        </div>
        <form className="form" onSubmit={submit} noValidate>
          <Field id="pair-code" label="Pairing code" error={error}>
            <input
              className="input input-code"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              value={code}
              maxLength={9}
              placeholder="K7QM-3XRP"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </Field>
          <Button type="submit" kind="primary" block busy={busy} busyLabel="Pairing…">
            Pair this device
          </Button>
        </form>
      </div>
    </main>
  );
}
