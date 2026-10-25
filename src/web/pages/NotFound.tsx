import { Link, useParams } from 'react-router';
import { useTitle } from '../useTitle';

/** A wrong address: say so plainly and offer the ways back. */
export function NotFound({ inEvent = false }: { inEvent?: boolean }) {
  useTitle('Page not found');
  const { eventId } = useParams();
  return (
    <div className="empty not-found">
      {inEvent ? <h2>This event doesn't have that page</h2> : <h1>There's no page at this address</h1>}
      <p className="lede">The link may be old, or the page may have moved.</p>
      <div className="actions">
        {inEvent ? (
          <Link className="btn" to={`/events/${eventId}`}>
            Back to the event
          </Link>
        ) : (
          <Link className="btn" to="/">
            Go to Home
          </Link>
        )}
        <Link className="btn btn-secondary" to="/scan">
          Scan
        </Link>
      </div>
    </div>
  );
}
