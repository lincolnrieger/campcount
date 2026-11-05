import { cloneElement, isValidElement, useEffect, useRef } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * A labelled form field. The hint and error are tied to the control with
 * aria-describedby, and an error marks it aria-invalid.
 */
export function Field({ id, label, hint, error, optional, children }: { id: string; label: string; hint?: ReactNode; error?: string; optional?: boolean; children: ReactNode }) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
  const control = isValidElement<Record<string, unknown>>(children)
    ? cloneElement(children, {
        id: children.props.id ?? id,
        'aria-describedby': [children.props['aria-describedby'], describedBy].filter(Boolean).join(' ') || undefined,
        'aria-invalid': error ? true : children.props['aria-invalid'],
      })
    : children;
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
        {optional && <span className="field-optional"> (optional)</span>}
      </label>
      {hint && (
        <span className="field-hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
      {control}
      {error && (
        <span className="field-error" id={`${id}-error`}>
          <Icon name="error" size={16} />
          {error}
        </span>
      )}
    </div>
  );
}

/** A checkbox or radio with a label and an optional one-line description. */
export function Choice({ label, description, ...input }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label className="choice">
      <input type="checkbox" {...input} />
      <span className="choice-text">
        <span>{label}</span>
        {description && <span className="meta">{description}</span>}
      </span>
    </label>
  );
}

/** Search box with an icon and a hidden label. */
export function SearchField({ id, label, value, onChange, placeholder, autoFocus }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <div className="search" role="search">
      <label htmlFor={id} className="visually-hidden">
        {label}
      </label>
      <Icon name="search" />
      <input
        id={id}
        className="input"
        type="search"
        value={value}
        placeholder={placeholder ?? label}
        autoComplete="off"
        // Sheets ask for focus straight away: it's the only thing to do there.
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/**
 * The list of problems shown at the top of a form after a failed submit.
 * It takes focus so screen readers read it, and each item links to its field.
 */
export function ErrorSummary({ errors }: { errors: { id: string; message: string }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const key = errors.map((e) => e.id + e.message).join('|');
  useEffect(() => {
    if (key) ref.current?.focus();
  }, [key]);
  if (errors.length === 0) return null;
  return (
    <div className="error-summary" role="alert" tabIndex={-1} ref={ref}>
      <strong>{errors.length === 1 ? 'Fix this to continue:' : `Fix these ${errors.length} things to continue:`}</strong>
      <ul>
        {errors.map((e) => (
          <li key={e.id}>
            <a href={`#${e.id}`}>{e.message}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
