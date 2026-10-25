import { useState } from 'react';
import { Link } from 'react-router';
import { ApiFailure, api } from '../api';
import { Loading, LoadError, Notice, PageHeader, SkeletonList } from '../components/ui';
import { Menu } from '../components/Menu';
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
  useTitle('Demo camps');
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
      <PageHeader
        title={<span className="visually-hidden">Demo camps</span>}
        sub="A practice camp filled with made-up people. Use View as to try each role. No real member data is used."
      />
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
            {busy ? 'Creating…' : 'Create demo camp'}
          </button>
        </div>
      </section>

      {loading && !data && (
        <Loading label="Loading demo camps">
          <SkeletonList rows={2} aside="button" />
        </Loading>
      )}
      {error && <LoadError error={error} onRetry={reload} />}
      {data && data.events.length > 0 && (
        <section className="list-section section-gap">
          <h2 className="list-heading">Your demo camps</h2>
          <ul className="list">
            {data.events.map((e) => (
              <li key={e.id} className="list-row demo-row">
                <span className="list-main">
                  <strong>
                    <Link to={`/events/${e.id}`}>{e.name}</Link>
                  </strong>
                  <span>{e.people} people</span>
                </span>
                <button type="button" className="btn btn-secondary btn-small" onClick={() => setViewing(e.id)}>
                  <Icon name="eye" size={18} /> View as a role
                </button>
                <Menu
                  label={`More actions for ${e.name}`}
                  items={[
                    {
                      label: 'Delete demo camp…',
                      danger: true,
                      onSelect: () => {
                        if (window.confirm(`Delete ${e.name} and all its demo data?`)) void act(() => api(`/admin/demo/${e.id}`, { method: 'DELETE' }), 'Demo camp deleted.');
                      },
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      <ViewAsSheet open={viewing !== null} onClose={() => setViewing(null)} initialEventId={viewing ?? undefined} />
    </>
  );
}
