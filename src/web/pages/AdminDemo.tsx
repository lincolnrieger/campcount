import { useState } from 'react';
import { Link } from 'react-router';
import { ApiFailure, api } from '../api';
import { Loading, Notice } from '../components/ui';
import { clearDevice } from '../offline/db';
import { useApi } from '../useApi';

interface DemoEvent {
  id: string;
  name: string;
  status: string;
  people: number;
  accounts: { id: string; name: string; role: string; activity: string | null }[];
}

export function AdminDemo() {
  const { data, error, loading, reload } = useApi<{ events: DemoEvent[] }>('/admin/demo');
  const [size, setSize] = useState('80');
  const [message, setMessage] = useState<{ tone: 'ok' | 'stop'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (success) setMessage({ tone: 'ok', text: success });
      await reload();
    } catch (err) {
      setMessage({ tone: 'stop', text: err instanceof ApiFailure ? err.message : 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  }

  async function switchToAccount(account: DemoEvent['accounts'][number]) {
    if (!window.confirm(`Switch to ${account.name}? You'll be signed out of your own account. Sign back in with your password to return.`)) return;
    await act(async () => {
      await clearDevice(true);
      await api(`/admin/demo/users/${account.id}/switch`, { method: 'POST' });
      window.location.assign('/');
    });
  }

  return (
    <>
      <div className="page-head">
        <h1>Demo mode</h1>
      </div>
      <p className="narrow">
        Create a practice camp filled with made-up people, then try CampCount as a director, leader or volunteer. Demo camps are
        clearly marked and can be deleted in one step. No real member data is used.
      </p>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <section className="narrow">
        <h2>New demo camp</h2>
        <div className="inline-form">
          <label className="visually-hidden" htmlFor="demo-size">
            Number of youth participants
          </label>
          <select id="demo-size" className="input" value={size} onChange={(e) => setSize(e.target.value)}>
            <option value="20">20 youth</option>
            <option value="80">80 youth</option>
            <option value="200">200 youth</option>
            <option value="400">400 youth</option>
          </select>
          <button
            className="btn"
            disabled={busy}
            onClick={() => void act(() => api('/admin/demo', { body: { participants: Number(size) } }), 'Demo camp created. You are its Camp Director.')}
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </section>

      {loading && !data && <Loading />}
      {error && <Notice tone="stop">{error.message}</Notice>}
      {data?.events.map((e) => (
        <section key={e.id} className="section-gap demo-event">
          <div className="page-head">
            <div>
              <h2 className="flush">{e.name}</h2>
              <p className="field-hint flush">{e.people} people</p>
            </div>
            <div className="actions flush">
              <Link className="btn btn-secondary" to={`/events/${e.id}`}>
                Open
              </Link>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete ${e.name} and all its demo data?`)) void act(() => api(`/admin/demo/${e.id}`, { method: 'DELETE' }), 'Demo camp deleted.');
                }}
              >
                Delete
              </button>
            </div>
          </div>
          <h3>Try it as</h3>
          <ul className="launch">
            {e.accounts.map((a) => (
              <li key={a.id}>
                <button type="button" className="launch-button" disabled={busy} onClick={() => void switchToAccount(a)}>
                  {a.role} <span>{a.activity ?? a.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
