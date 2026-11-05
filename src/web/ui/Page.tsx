import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon } from './Icon';
import { Menu } from './Menu';
import type { MenuItem } from './Menu';
import { useTitle } from '../shell';

/**
 * Every page starts with this: an optional back link, the page's one h1, a
 * one-line summary, the one primary action and the ⋯ menu. On phones the
 * primary action moves to a bar at the bottom of the screen.
 */
export function PageHeader({
  title,
  back,
  summary,
  primary,
  menu,
  menuLabel,
  docTitle,
}: {
  title: ReactNode;
  back?: { to: string; label: string };
  summary?: ReactNode;
  primary?: ReactNode;
  menu?: (MenuItem | false | null | undefined)[];
  menuLabel?: string;
  /** The browser tab title, when `title` isn't plain text. */
  docTitle?: string;
}) {
  useTitle(docTitle ?? (typeof title === 'string' ? title : null));
  return (
    <header className="page-header">
      {back && (
        <Link to={back.to} className="back-link">
          <Icon name="back" />
          {back.label}
        </Link>
      )}
      <div className="page-header-row">
        <div className="page-header-text">
          <h1 tabIndex={-1}>{title}</h1>
          {summary && <div className="page-header-summary">{summary}</div>}
        </div>
        {(primary || menu) && (
          <div className="page-header-actions">
            {primary && <div className="page-primary">{primary}</div>}
            {menu && <Menu label={menuLabel ?? 'More actions'} items={menu} />}
          </div>
        )}
      </div>
    </header>
  );
}

/** A titled section of a page. */
export function Section({ title, id, actions, children, level = 2 }: { title: ReactNode; id?: string; actions?: ReactNode; children: ReactNode; level?: 2 | 3 }) {
  const H = level === 2 ? 'h2' : 'h3';
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section className="section" aria-labelledby={headingId}>
      <div className="section-head">
        <H id={headingId}>{title}</H>
        {actions}
      </div>
      {children}
    </section>
  );
}
