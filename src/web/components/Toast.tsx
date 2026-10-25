import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';

interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'stop';
  undo?: () => Promise<unknown> | void;
}

type Show = (text: string, options?: { tone?: 'ok' | 'stop'; undo?: Toast['undo'] }) => void;

const ToastContext = createContext<Show>(() => undefined);

/** Confirm a finished action: `toast('Meal deleted.')`, optionally with an Undo. */
export function useToast(): Show {
  return useContext(ToastContext);
}

/**
 * One message at a time, above the tab bar, read out politely by screen
 * readers. It stays while focused, and Undo gets ten seconds.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const [held, setHeld] = useState(false);
  const next = useRef(1);
  const show = useCallback<Show>((text, options = {}) => {
    setToast({ id: next.current++, text, tone: options.tone ?? 'ok', undo: options.undo });
  }, []);

  useEffect(() => {
    if (!toast || held) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 10000 : 6000);
    return () => clearTimeout(t);
  }, [toast, held]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <div key={toast.id} className={`toast toast-${toast.tone}`}>
            <span className="toast-mark" aria-hidden="true">
              {toast.tone === 'ok' ? '✓' : '!'}
            </span>
            <p>{toast.text}</p>
            {toast.undo && (
              <button
                type="button"
                className="toast-action"
                onFocus={() => setHeld(true)}
                onBlur={() => setHeld(false)}
                onClick={async () => {
                  const undo = toast.undo!;
                  setToast(null);
                  setHeld(false);
                  try {
                    await undo();
                    show('Undone.');
                  } catch {
                    show("Couldn't undo that. Check your signal and try again.", { tone: 'stop' });
                  }
                }}
              >
                Undo
              </button>
            )}
            <button
              type="button"
              className="toast-close"
              onFocus={() => setHeld(true)}
              onBlur={() => setHeld(false)}
              aria-label="Dismiss"
              onClick={() => {
                setToast(null);
                setHeld(false);
              }}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
