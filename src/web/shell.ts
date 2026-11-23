import { useEffect, useSyncExternalStore } from 'react';
import type { EventStatus } from '../shared/schemas';

/** A page under a section. `also`: other paths that count as this page (sub-pages). */
export interface NavPage {
  to: string;
  label: string;
  also?: string[];
}
/** One section of an event: where its name goes, and the pages under it (if any). */
export interface NavSection {
  to: string;
  label: string;
  icon?: string;
  children?: NavPage[];
}

/**
 * Which section and page a path is in: the longest matching path wins, so
 * people/lanyards/print is Lanyards, not People. `rel` is the path inside
 * the event, without a leading slash ('' is Home).
 */
export function activeNav(sections: NavSection[], rel: string): { section: string | null; page: string | null } {
  let best = { section: null as string | null, page: null as string | null, len: -1 };
  const hit = (path: string) => (path === '' ? rel === '' : rel === path || rel.startsWith(`${path}/`));
  for (const s of sections) {
    if (hit(s.to) && s.to.length > best.len) best = { section: s.to, page: null, len: s.to.length };
    for (const c of s.children ?? [])
      for (const path of [c.to, ...(c.also ?? [])]) if (hit(path) && path.length >= best.len) best = { section: s.to, page: c.to, len: path.length };
  }
  return { section: best.section, page: best.page };
}

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
  /** The event's sections (groups in the sidebar), each with the pages under it. */
  sections: NavSection[];
  /** '' on the event's own site, '/events/<id>' on the main site. */
  base: string;
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
