import { Link, Navigate } from 'react-router';
import { Icon, PageHeader } from '../ui';
import type { IconName } from '../ui';
import { useEvent } from './EventLayout';

/**
 * Links & sign-up: every link participants are sent, in one place. Each card
 * opens the page it always was; nothing here changes how they work.
 */
export function LinksHub() {
  const { event, can, base } = useEvent();
  const signup = event.features.activities && event.features.selfSignup && can('activities.manage');
  const rows = [
    can('activities.manage') && {
      to: 'people/share',
      icon: 'team',
      title: 'Links for everyone',
      body: 'One link for all participants, and the camp website',
    },
    signup && { to: 'activities/links', icon: 'ticket', title: 'Booking links', body: 'A link per activity, for emails' },
    signup && { to: 'activities/signup', icon: 'qr', title: 'Sign-up kiosk & posters', body: 'Tablet sign-up screen and activity posters' },
    can('credentials.manage') && {
      to: 'people/links',
      icon: 'user',
      title: 'Each person’s own link',
      body: 'Same as their lanyard QR. Copy or download',
    },
  ].filter((r): r is { to: string; icon: IconName; title: string; body: string } => Boolean(r));
  if (rows.length === 0) return <Navigate to={base || '/'} replace />;
  return (
    <>
      <PageHeader title="Links" help="Every link participants are sent, and how they sign up for activities, in one place." />
      <ul className="settings-grid links-hub">
        {rows.map((r) => (
          <li key={r.to} className="panel settings-card row-link">
            <span className="settings-card-icon" aria-hidden="true">
              <Icon name={r.icon} />
            </span>
            <span className="row-main">
              <span className="row-title">
                <Link to={`${base}/${r.to}`}>{r.title}</Link>
              </span>
              <span className="row-meta">{r.body}</span>
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
