import { useEffect, useRef } from 'react';

/**
 * Run `refresh` every `intervalMs` while the page is on screen.
 *
 * - Paused while the tab is hidden or the phone is offline, so a dashboard
 *   left open in a background tab costs nothing.
 * - Each wait is jittered by ±20%, so hundreds of devices that opened the
 *   page together don't all ask the server in the same second.
 * - Refreshes straight away when the page comes back on screen, if the last
 *   refresh is older than the interval.
 */
export function usePolling(refresh: () => unknown, intervalMs: number): void {
  const fn = useRef(refresh);
  useEffect(() => {
    fn.current = refresh;
  }, [refresh]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = Date.now();
    const visible = () => document.visibilityState === 'visible';

    const schedule = () => {
      if (timer) clearTimeout(timer);
      const wait = intervalMs * (0.8 + Math.random() * 0.4);
      timer = setTimeout(tick, wait);
    };
    const tick = () => {
      timer = null;
      if (!visible() || !navigator.onLine) return; // resumes on visibilitychange / online
      last = Date.now();
      void fn.current();
      schedule();
    };
    const wake = () => {
      if (!visible() || !navigator.onLine) return;
      if (Date.now() - last >= intervalMs) tick();
      else if (!timer) schedule();
    };

    schedule();
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
  }, [intervalMs]);
}
