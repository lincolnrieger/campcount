import { useEffect, useSyncExternalStore } from 'react';
import type { EventStatus } from '../shared/schemas';

/**
 * What the app frame needs to know about the current page: inside an event,
 * the event and the sections this person can open (sidebar on computers,
 * tab row on phones, and the browser tab title).
 */
export interface ShellEvent {
  id: string;
  name: string;
  status: EventStatus;
  isDemo: boolean;
  sections: { to: string; label: string }[];
}
interface ShellState {
  event: ShellEvent | null;
}

let state: ShellState = { event: null };
let pageTitle: string | null = null;
const listeners = new Set<() => void>();
function set(patch: Partial<ShellState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
  applyTitle();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
function applyTitle() {
  const parts = [pageTitle, state.event && state.event.name !== pageTitle ? state.event.name : null, 'CampCount'].filter(Boolean);
  document.title = parts.join(' · ');
}

export function useShell(): ShellState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Name the page for the browser tab: "People · Summer Camp · CampCount". */
export function useTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return;
    pageTitle = title;
    applyTitle();
  }, [title]);
}

/** Inside an event: tell the frame which event and sections to show. */
export function useShellEvent(event: ShellEvent | null) {
  const key = event ? JSON.stringify(event) : null;
  useEffect(() => {
    set({ event: key ? (JSON.parse(key) as ShellEvent) : null });
    return () => set({ event: null });
  }, [key]);
}
