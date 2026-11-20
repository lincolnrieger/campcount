import { useCallback, useEffect, useRef, useState } from 'react';
import type { LanyardDesign } from '../../shared/lanyardDesign';
import { lanyardDesignSchema, starterDesign } from '../../shared/lanyardDesign';
import { ApiFailure, api } from '../api';

/** Load a camp's design, or the starter design if it hasn't made one. */
export async function fetchDesign(eventId: string): Promise<{ design: LanyardDesign; saved: boolean }> {
  const res = await api<{ design: LanyardDesign | null }>(`/events/${eventId}/lanyard-design`);
  const parsed = res.design ? lanyardDesignSchema.safeParse(res.design) : null;
  return parsed?.success ? { design: parsed.data, saved: true } : { design: starterDesign(), saved: false };
}

export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';

const HISTORY = 100;

/**
 * The design being edited: undo/redo history, and an autosave a moment
 * after each change. Drags and slider moves change the design "live" and
 * become one undo step when they finish.
 */
export function useDesignEditor(eventId: string, canEdit: boolean) {
  const [loadError, setLoadError] = useState<ApiFailure | null>(null);
  const [state, setState] = useState<{ past: LanyardDesign[]; present: LanyardDesign | null; future: LanyardDesign[] }>({ past: [], present: null, future: [] });
  const [save, setSave] = useState<{ state: SaveState; message: string | null }>({ state: 'saved', message: null });
  const lastSaved = useRef<string>('');
  const liveStart = useRef<LanyardDesign | null>(null);

  const load = useCallback(async () => {
    try {
      const { design, saved } = await fetchDesign(eventId);
      lastSaved.current = saved ? JSON.stringify(design) : '';
      setState({ past: [], present: design, future: [] });
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiFailure ? err : new ApiFailure(0, 'offline', 'No connection.'));
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Change the design. `live` changes (dragging) don't add undo steps until `commit`. */
  const change = useCallback((next: LanyardDesign | ((d: LanyardDesign) => LanyardDesign), opts: { live?: boolean } = {}) => {
    setState((s) => {
      if (!s.present) return s;
      const value = typeof next === 'function' ? next(s.present) : next;
      if (opts.live) {
        if (!liveStart.current) liveStart.current = s.present;
        return { ...s, present: value };
      }
      const base = liveStart.current ?? s.present;
      liveStart.current = null;
      if (JSON.stringify(base) === JSON.stringify(value)) return { ...s, present: value };
      return { past: [...s.past, base].slice(-HISTORY), present: value, future: [] };
    });
  }, []);

  /** End a live change: it becomes one undo step. */
  const commit = useCallback(() => {
    setState((s) => {
      const base = liveStart.current;
      liveStart.current = null;
      if (!base || !s.present || JSON.stringify(base) === JSON.stringify(s.present)) return s;
      return { past: [...s.past, base].slice(-HISTORY), present: s.present, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    setState((s) => (s.past.length && s.present ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1]!, future: [s.present, ...s.future] } : s));
  }, []);
  const redo = useCallback(() => {
    setState((s) => (s.future.length && s.present ? { past: [...s.past, s.present], present: s.future[0]!, future: s.future.slice(1) } : s));
  }, []);

  // Autosave, a moment after the last change.
  const present = state.present;
  const saveNow = useCallback(async (design: LanyardDesign) => {
    const text = JSON.stringify(design);
    if (text === lastSaved.current) return;
    setSave({ state: 'saving', message: null });
    try {
      await api(`/events/${eventId}/lanyard-design`, { method: 'PUT', body: { design } });
      lastSaved.current = text;
      setSave({ state: 'saved', message: null });
    } catch (err) {
      setSave({ state: 'error', message: err instanceof ApiFailure ? err.message : 'No connection. Your changes will save when you’re back online.' });
    }
  }, [eventId]);

  useEffect(() => {
    if (!canEdit || !present || liveStart.current) return;
    if (JSON.stringify(present) === lastSaved.current) return;
    setSave((s) => (s.state === 'saving' ? s : { state: 'unsaved', message: null }));
    const t = window.setTimeout(() => void saveNow(present), 700);
    return () => window.clearTimeout(t);
  }, [present, canEdit, saveNow]);

  // Retry a failed save when the connection comes back.
  useEffect(() => {
    if (save.state !== 'error' || !present) return;
    const retry = () => void saveNow(present);
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [save.state, present, saveNow]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (save.state === 'saved') return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [save.state]);

  return {
    design: present,
    loadError,
    reload: load,
    change,
    commit,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    save,
    retrySave: () => present && void saveNow(present),
  };
}
