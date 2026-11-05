import { useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router';
import type { LinkProps } from 'react-router';

export type ButtonKind = 'primary' | 'secondary' | 'danger' | 'ghost';

const cls = (kind: ButtonKind, small?: boolean, block?: boolean, extra?: string) =>
  ['btn', `btn-${kind}`, small && 'btn-small', block && 'btn-block', extra].filter(Boolean).join(' ');

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  kind?: ButtonKind;
  small?: boolean;
  block?: boolean;
  /** Async work: the button disables itself and shows `busyLabel` until it finishes, so it can't be sent twice. */
  onAction?: () => Promise<unknown> | unknown;
  onClick?: ButtonHTMLAttributes<HTMLButtonElement>['onClick'];
  busy?: boolean;
  busyLabel?: string;
};

export function Button({ kind = 'secondary', small, block, onAction, onClick, busy: busyProp, busyLabel, className, children, disabled, type = 'button', ...rest }: Props) {
  const [running, setRunning] = useState(false);
  const busy = busyProp || running;
  return (
    <button
      {...rest}
      type={type}
      className={cls(kind, small, block, className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={async (e) => {
        onClick?.(e);
        if (!onAction) return;
        setRunning(true);
        try {
          await onAction();
        } finally {
          setRunning(false);
        }
      }}
    >
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}

/** A link that looks like a button (navigation, not an action). */
export function ButtonLink({ kind = 'secondary', small, block, className, children, ...rest }: LinkProps & { kind?: ButtonKind; small?: boolean; block?: boolean; children: ReactNode }) {
  return (
    <Link {...rest} className={cls(kind, small, block, className)}>
      {children}
    </Link>
  );
}

/** An icon-only button. The label is required: it's the button's accessible name. */
export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" {...rest} className={['icon-btn', className].filter(Boolean).join(' ')} aria-label={label} title={label}>
      {children}
    </button>
  );
}
