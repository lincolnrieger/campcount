import { Link, Navigate } from 'react-router';
import { useSession } from '../session';
import { Icon, PageHeader } from '../ui';

const SECTIONS = [
  { to: '/admin/accounts', label: 'Accounts', hint: 'Who can sign in, administrators, password links' },
  { to: '/admin/log', label: 'Activity log', hint: 'Who did what, and when' },
  { to: '/admin/demo', label: 'Demo camps', hint: 'Practice events with made-up people, for training' },
];

/** Admin: the three admin areas. Platform admins only (the server checks too). */
export function AdminIndex() {
  const { me } = useSession();
  if (me?.kind !== 'user' || !me.platformPermissions.includes('platform.users.manage')) return <Navigate to="/" replace />;
  return (
    <>
      <PageHeader title="Admin" />
      <ul className="list">
        {SECTIONS.map((s) => (
          <li key={s.to} className="row row-link">
            <span className="row-main">
              <span className="row-title">
                <Link to={s.to}>{s.label}</Link>
              </span>
              <span className="row-meta">{s.hint}</span>
            </span>
            <span className="row-chevron">
              <Icon name="chevron" />
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Platform admins only: everyone else is sent home. */
export function useAdminOnly(): boolean {
  const { me } = useSession();
  return me?.kind === 'user' && me.platformPermissions.includes('platform.users.manage');
}
