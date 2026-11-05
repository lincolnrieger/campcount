import { useEffect, useSyncExternalStore } from 'react';

/**
 * What the app shell needs to know about the current page: its title (for
 * the phone top bar and the last breadcrumb) and, inside an event, the
 * event and the sections this person can open (for the sidebar).
 */
export interface ShellEvent {
  id: string;
  name: string;
  meta: string;
  sections: { to: string; label: string }[];
}
interface ShellState {
  title: string | null;
  event: ShellEvent | null;
}

let state: ShellState = { title: null, event: null };
const listeners = new Set<() => void>();
function set(patch: Partial<ShellState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useShell(): ShellState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Name the page: the browser tab, what screen readers announce, the phone top bar and the last breadcrumb. */
export function useTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return;
    document.title = `${title} · CampCount`;
    set({ title });
  }, [title]);
}

/** Inside an event: tell the sidebar which event and sections to show. */
export function useShellEvent(event: ShellEvent | null) {
  const key = event ? JSON.stringify(event) : null;
  useEffect(() => {
    set({ event: key ? (JSON.parse(key) as ShellEvent) : null });
    return () => set({ event: null });
  }, [key]);
}
