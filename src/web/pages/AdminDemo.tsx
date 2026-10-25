import { useState } from 'react';
import { Link } from 'react-router';
import { ApiFailure, api } from '../api';
import { Loading, Notice, SkeletonList } from '../components/ui';
import { Icon } from '../components/Icon';
import { ViewAsSheet } from '../components/ViewAs';
import { useApi } from '../useApi';
import { useTitle } from '../useTitle';

interface DemoEvent {
  id: string;
  name: string;
  status: string;
  people: number;
  accounts: { id: string; name: string; role: string; activity: string | null }[];
}

export function AdminDemo() {
  useTitle('Demo mode');
  const { data, error, loading, reload } = useApi<{ events: DemoEvent[] }>('/admin/demo');
  const [size, setSize] = useState('80');
  const [message, setMessage] = useState<{ tone: 'ok' | 'stop'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);

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

  return (
    <>
      <div className="page-head">
        <h1>Demo mode</h1>
      </div>
      <p className="narrow">
        Create a practice camp filled with made-up people, then use View as to try each role. No real member data is used.
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
            onClick={() => void act(() => api('/admin/demo', { body: { participants: Number(size) } }), 'Demo camp ready. You are its event manager.')}
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </section>

      {loading && !data && (
        <Loading label="Loading demo camps">
          <SkeletonList rows={2} aside="button" />
        </Loading>
      )}
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
          <button type="button" className="btn btn-block" onClick={() => setViewing(e.id)}>
            <Icon name="eye" /> Try it as a role
          </button>
        </section>
      ))}
      <ViewAsSheet open={viewing !== null} onClose={() => setViewing(null)} initialEventId={viewing ?? undefined} />
    </>
  );
}
