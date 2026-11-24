import { Link, Navigate } from 'react-router';
import { useSession } from '../session';
import { Icon, PageHeader } from '../ui';
import type { IconName } from '../ui';

const AREAS: { to: string; label: string; hint: string; icon: IconName }[] = [
  { to: '/admin/accounts', label: 'Accounts', hint: 'Sign-ins, admins, set-up links', icon: 'team' },
  { to: '/admin/log', label: 'Activity log', hint: 'Every scan and change', icon: 'clipboard' },
  { to: '/admin/demo', label: 'Demo camps', hint: 'Practice camps for training', icon: 'star' },
];

/** Admin: the three admin areas. Platform admins only (the server checks too). */
export function AdminIndex() {
  const { me } = useSession();
  if (me?.kind !== 'user' || !me.platformPermissions.includes('platform.users.manage')) return <Navigate to="/" replace />;
  return (
    <>
      <PageHeader title="Admin" />
      <ul className="pf-cards">
        {AREAS.map((s) => (
          <li key={s.to} className="pf-card row-link">
            <span className="pf-card-icon" aria-hidden="true">
              <Icon name={s.icon} size={24} />
            </span>
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
