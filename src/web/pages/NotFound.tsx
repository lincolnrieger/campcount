import { useParams } from 'react-router';
import { useSiteEvent } from '../site';
import { ButtonLink, EmptyState, PageHeader } from '../ui';

/** A wrong address: say so plainly and offer the way back. */
export function NotFound({ inEvent = false }: { inEvent?: boolean }) {
  const { eventId } = useParams();
  const siteEvent = useSiteEvent();
  const home = eventId ? `/events/${eventId}` : '/';
  const label = inEvent || siteEvent ? 'Go to the camp home' : 'Go to the start';
  return (
    <>
      <PageHeader title="There's no page at this address" />
      <EmptyState
        title="The link may be old, or the page may have moved"
        actions={
          <ButtonLink to={home} kind="primary">
            {label}
          </ButtonLink>
        }
      >
        Check the address, or start again from the beginning.
      </EmptyState>
    </>
  );
}
