import { Link } from 'react-router';
import { useSession } from '../session';
import { useShell } from '../shell';
import { Button, Icon, PageHeader } from '../ui';

/** Phones, on an event's own site: the sections that don't fit in the tab bar, plus Account. */
export function More() {
  const { event } = useShell();
  const { signOut } = useSession();
  const rest = (event?.sections ?? []).slice(3);
  return (
    <>
      <PageHeader title="More" />
      <div className="sections">
        <ul className="list">
          {[...rest, { to: 'account', label: 'Account' }].map((s) => (
            <li key={s.to} className="row row-link row-large">
              <span className="row-main">
                <span className="row-title">
                  <Link to={`/${s.to}`}>{s.label}</Link>
                </span>
              </span>
              <span className="row-chevron">
                <Icon name="chevron" />
              </span>
            </li>
          ))}
        </ul>
        <div>
          <Button onClick={() => void signOut()}>Sign out</Button>
        </div>
      </div>
    </>
  );
}
