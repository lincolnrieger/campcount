import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { IconButton } from './Button';
import { Icon } from './Icon';

interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  /** The action, named by its verb: "Delete activity". */
  confirm: string;
  danger?: boolean;
  /** Ask the person to type this word first (for the most destructive actions). */
  typeToConfirm?: string;
}
type Ask = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Ask>(async () => false);

/** `if (await confirm({ title: 'Delete Kayaking?', confirm: 'Delete activity', danger: true })) …` */
export function useConfirm(): Ask {
  return useContext(ConfirmContext);
}

/**
 * One confirm dialog for the app, on a native <dialog>: focus moves into it
 * (to Cancel), Escape closes it, the page behind is inert, and focus returns
 * to whatever opened it.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [typed, setTyped] = useState('');
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const id = useId();

  const ask = useCallback<Ask>(
    (options) =>
      new Promise<boolean>((resolve) => {
        opener.current = document.activeElement as HTMLElement | null;
        setTyped('');
        setRequest({ ...options, resolve });
      }),
    [],
  );

  useEffect(() => {
    if (request && ref.current && !ref.current.open) ref.current.showModal();
  }, [request]);

  const finish = (value: boolean) => {
    request?.resolve(value);
    ref.current?.close();
    setRequest(null);
    // The opener may have gone (a deleted row); fall back to the page heading.
    const back = opener.current?.isConnected ? opener.current : document.querySelector<HTMLElement>('#main h1');
    back?.focus();
  };

  const blocked = !!request?.typeToConfirm && typed.trim().toUpperCase() !== request.typeToConfirm.toUpperCase();

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <dialog
        ref={ref}
        className="dialog"
        aria-labelledby={`${id}-title`}
        aria-describedby={request?.body ? `${id}-body` : undefined}
        onCancel={(e) => {
          e.preventDefault();
          finish(false);
        }}
      >
        {request && (
          <form
            className="dialog-body"
            method="dialog"
            onSubmit={(e) => {
              e.preventDefault();
              if (!blocked) finish(true);
            }}
          >
            <h2 id={`${id}-title`}>{request.title}</h2>
            {request.body && <div id={`${id}-body`}>{request.body}</div>}
            {request.typeToConfirm && (
              <div className="field">
                <label htmlFor={`${id}-type`} className="field-label">
                  Type {request.typeToConfirm} to confirm
                </label>
                <input id={`${id}-type`} className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
              </div>
            )}
            <div className="dialog-actions">
              {/* Cancel takes focus first, so Enter on open never confirms by accident. */}
              {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
              <Button autoFocus onClick={() => finish(false)}>
                Cancel
              </Button>
              <Button type="submit" kind={request.danger ? 'danger' : 'primary'} disabled={blocked}>
                {request.confirm}
              </Button>
            </div>
          </form>
        )}
      </dialog>
    </ConfirmContext.Provider>
  );
}

/**
 * A focused task over the page: a bottom sheet on phones, a dialog on
 * computers. Focus is trapped inside; Escape or the close button closes it.
 */
export function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement as HTMLElement | null;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
      if (opener.current?.isConnected) opener.current.focus();
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={`${id}-title`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {open && (
        <>
          <div className="sheet-head">
            <h2 id={`${id}-title`}>{title}</h2>
            <IconButton label="Close" onClick={onClose}>
              <Icon name="close" size={24} />
            </IconButton>
          </div>
          <div className="sheet-body">{children}</div>
        </>
      )}
    </dialog>
  );
}
