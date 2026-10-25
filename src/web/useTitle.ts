import { useEffect } from 'react';

/** Name the browser tab (and what screen readers announce on navigation) after the page. */
export function useTitle(title: string | null | undefined) {
  useEffect(() => {
    if (title) document.title = `${title} · CampCount`;
  }, [title]);
}
