import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';

interface ToastItem {
  id: number;
  text: string;
  tone: 'ok' | 'error';
  undo?: () => Promise<unknown> | void;
}
type Show = (text: string, options?: { tone?: 'ok' | 'error'; undo?: ToastItem['undo'] }) => void;

const ToastContext = createContext<Show>(() => undefined);

/** Confirm a finished action: `toast('Activity added')`, optionally with Undo. */
export function useToast(): Show {
  return useContext(ToastContext);
}

/** One message at a time, read out politely. It stays while hovered or focused; Undo gets ten seconds. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const [held, setHeld] = useState(false);
  const next = useRef(1);
  const show = useCallback<Show>((text, options = {}) => {
    setToast({ id: next.current++, text, tone: options.tone ?? 'ok', undo: options.undo });
  }, []);

  useEffect(() => {
    if (!toast || held) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 10000 : 5000);
    return () => clearTimeout(t);
  }, [toast, held]);

  const hold = { onFocus: () => setHeld(true), onBlur: () => setHeld(false) };

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-region" role="status" aria-live="polite" onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}>
        {toast && (
          <div key={toast.id} className={`toast toast-${toast.tone}`}>
            <Icon name={toast.tone === 'ok' ? 'success' : 'error'} />
            <p>{toast.text}</p>
            {toast.undo && (
              <button
                type="button"
                className="btn btn-ghost btn-small"
                {...hold}
                onClick={async () => {
                  const undo = toast.undo!;
                  setToast(null);
                  setHeld(false);
                  try {
                    await undo();
                    show('Undone');
                  } catch {
                    show("Couldn't undo that. Check your signal and try again.", { tone: 'error' });
                  }
                }}
              >
                Undo
              </button>
            )}
            <button
              type="button"
              className="icon-btn"
              aria-label="Dismiss message"
              {...hold}
              onClick={() => {
                setToast(null);
                setHeld(false);
              }}
            >
              <Icon name="close" />
            </button>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
