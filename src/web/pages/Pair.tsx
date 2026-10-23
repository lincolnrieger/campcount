import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ApiFailure, api } from '../api';
import { Field, Notice } from '../components/ui';
import { useSession } from '../session';

/** Turn this device into a station. The code can also arrive in the URL fragment from the pairing QR. */
export function Pair() {
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [code, setCode] = useState(() => window.location.hash.slice(1).toUpperCase());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/stations/pair', { body: { code } });
      history.replaceState(null, '', '/pair');
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <main className="page narrow">
      <h1>Set up this device as a station</h1>
      <p className="lede">Enter the pairing code shown on the director's screen. This device will then only scan for one activity or meal.</p>
      {error && <Notice tone="stop">{error}</Notice>}
      <form onSubmit={submit} noValidate>
        <Field id="pair-code" label="Pairing code">
          <input
            id="pair-code"
            className="input input-code"
            autoCapitalize="characters"
            autoComplete="off"
            value={code}
            maxLength={9}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </Field>
        <button className="btn btn-block" disabled={busy || code.replace(/-/g, '').length !== 8}>
          {busy ? 'Pairing…' : 'Pair this device'}
        </button>
      </form>
    </main>
  );
}
