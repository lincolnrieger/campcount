import { Link, Navigate } from 'react-router';
import { useTitle } from '../shell';
import { Icon } from '../ui';
import { useSiteEvent } from '../site';

/**
 * The front of a camp's own address (supersplash.campcount.com): are you a
 * participant (type your membership number, see the parts of your page the
 * camp has switched on) or on the event team (sign in)?
 */
export function FrontDoor() {
  const event = useSiteEvent();
  useTitle(event?.name ?? 'Welcome');
  if (!event?.participantCode) return <Navigate to="/sign-in" replace />;
  return (
    <main className="public" id="main">
      <div className="public-card door">
        <header className="join-head">
          <h1>{event.name}</h1>
          <p>Who are you?</p>
        </header>
        <nav className="door-choices" aria-label="Choose how to continue">
          <Link className="door-choice" to={`/p/${event.participantCode}`}>
            <span className="door-text">
              <strong>Participant</strong>
              <span>Use your Scouts SA membership number</span>
            </span>
            <Icon name="chevron" size={22} />
          </Link>
          <Link className="door-choice" to="/sign-in">
            <span className="door-text">
              <strong>Event team</strong>
              <span>Leaders and staff sign in</span>
            </span>
            <Icon name="chevron" size={22} />
          </Link>
        </nav>
      </div>
    </main>
  );
}
