import { Link, Navigate } from 'react-router';
import { Icon, PageHeader } from '../ui';
import { useEvent } from './EventLayout';

/**
 * Links & sign-up: every link participants are sent, in one place. Each row
 * opens the page it always was; nothing here changes how they work.
 */
export function LinksHub() {
  const { event, can, base } = useEvent();
  const signup = event.features.activities && event.features.selfSignup && can('activities.manage');
  const rows = [
    can('activities.manage') && {
      to: 'people/share',
      title: 'Links for everyone',
      body: 'One link for all participants. They type their membership number and see the parts you switch on. Also what your camp’s own address offers participants.',
    },
    signup && { to: 'activities/links', title: 'Booking links', body: 'A link for each activity, to put in emails. People type their membership number and they’re booked.' },
    signup && { to: 'activities/signup', title: 'Sign-up kiosk & posters', body: 'The sign-up screen for a tablet at camp HQ, and a poster for each activity.' },
    can('credentials.manage') && {
      to: 'people/links',
      title: 'Each person’s own link',
      body: 'The same link as the QR code on their lanyard. Copy one, or download them all to email.',
    },
  ].filter((r): r is { to: string; title: string; body: string } => Boolean(r));
  if (rows.length === 0) return <Navigate to={base || '/'} replace />;
  return (
    <>
      <PageHeader title="Links" summary="Every link participants are sent, and how they sign up for activities, in one place." />
      <ul className="list links-hub">
        {rows.map((r) => (
          <li key={r.to} className="row row-link row-large">
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
