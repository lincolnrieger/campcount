import { useState } from 'react';
import { Link } from 'react-router';
import { ApiFailure, api } from '../api';
import { ViewAsSheet } from '../components/ViewAs';
import { useApi } from '../useApi';
import { Button, EmptyState, Icon, LoadError, Loading, Menu, PageHeader, Section, SkeletonRows, useConfirm, useToast } from '../ui';

interface DemoEvent {
  id: string;
  name: string;
  status: string;
  people: number;
  accounts: { id: string; name: string; role: string; activity: string | null }[];
}

/** Admin › Demo camps: practice camps full of made-up people, to try every role. */
export function AdminDemo() {
  const { data, error, loading, reload } = useApi<{ events: DemoEvent[] }>('/admin/demo');
  const toast = useToast();
  const confirm = useConfirm();
  const [size, setSize] = useState('80');
  const [viewing, setViewing] = useState<string | null>(null);

  async function create() {
    try {
      await api('/admin/demo', { body: { participants: Number(size) } });
      toast('Demo camp ready. You are its event manager.');
      await reload();
    } catch (err) {
      toast(err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.', { tone: 'error' });
    }
  }

  return (
    <>
      <PageHeader
        title="Demo camps"
        back={{ to: '/admin', label: 'Admin' }}
        summary="Practice camps with made-up people. No real member data is used."
        primary={
          <Button kind="primary" busyLabel="Creating…" onAction={create}>
            <Icon name="plus" />
            Create demo camp
          </Button>
        }
      />
      <div className="sections">
        <div className="field demo-size">
          <label htmlFor="demo-size" className="field-label">
            Size of the next demo camp
          </label>
          <select id="demo-size" className="select" value={size} onChange={(e) => setSize(e.target.value)}>
            <option value="20">20 young people</option>
            <option value="80">80 young people</option>
            <option value="200">200 young people</option>
            <option value="400">400 young people</option>
          </select>
        </div>

        <Section title="Your demo camps" id="demos">
          {loading && !data ? (
            <Loading what="demo camps">
              <SkeletonRows rows={2} action />
            </Loading>
          ) : error ? (
            <LoadError error={error} onRetry={reload} what="demo camps" />
          ) : !data || data.events.length === 0 ? (
            <EmptyState title="No demo camps yet">Create one to try CampCount as each role.</EmptyState>
          ) : (
            <ul className="list">
              {data.events.map((e) => (
                <li key={e.id} className="row row-link">
                  <span className="row-main">
                    <span className="row-title">
                      <Link to={`/camps/${e.id}`}>{e.name}</Link>
                    </span>
                    <span className="row-meta">
                      {e.people} people · {e.accounts.length} demo {e.accounts.length === 1 ? 'account' : 'accounts'}
                    </span>
                  </span>
                  <span className="row-side">
                    <Button small onClick={() => setViewing(e.id)} aria-haspopup="dialog">
                      <Icon name="eye" />
                      <span className="only-desktop">View as a role</span>
                      <span className="only-phone">View as</span>
                    </Button>
                    <Menu
                      label={`More actions for ${e.name}`}
                      items={[
                        {
                          label: 'Delete demo camp…',
                          danger: true,
                          onSelect: async () => {
                            const ok = await confirm({
                              title: `Delete ${e.name}?`,
                              body: <p>Its made-up people, scans and demo accounts are deleted too.</p>,
                              confirm: 'Delete demo camp',
                              danger: true,
                            });
                            if (!ok) return;
                            try {
                              await api(`/admin/demo/${e.id}`, { method: 'DELETE' });
                              toast(`Deleted ${e.name}`);
                              await reload();
                            } catch (err) {
                              toast(err instanceof ApiFailure ? err.message : 'No connection. Try again.', { tone: 'error' });
                            }
                          },
                        },
                      ]}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <ViewAsSheet open={viewing !== null} onClose={() => setViewing(null)} initialEventId={viewing ?? undefined} />
    </>
  );
}
