import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useParams } from 'react-router';
import { ApiFailure, api } from '../api';
import { EMPTY_PERSON, PersonFields, personBody, personReady } from '../components/PersonFields';
import type { PersonForm } from '../components/PersonFields';
import { Field, Notice, formatDateRange } from '../components/ui';

interface PageInfo {
  event: { name: string; startsOn: string; endsOn: string; location: string; description: string };
  open: boolean;
  closedMessage: string | null;
  closesOn: string | null;
  asksDietary: boolean;
  asksPhotos: boolean;
  approval: 'automatic' | 'manual';
}

const message = (err: unknown) => (err instanceof ApiFailure ? err.message : 'Something went wrong. Please try again.');

/**
 * The public page for registering someone for an event, opened from the
 * event's link or QR poster. No account needed: the email is confirmed with
 * a code, and the event team approves each registration.
 */
export function Register() {
  const { code } = useParams();
  const [info, setInfo] = useState<PageInfo | null>(null);
  const [missing, setMissing] = useState(false);
  const [person, setPerson] = useState<PersonForm>(EMPTY_PERSON);
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'form' | 'code' | 'done'>('form');
  const [requestId, setRequestId] = useState('');
  const [codeValue, setCodeValue] = useState('');
  // After the first confirmed registration, siblings don't need another code.
  const [contactToken, setContactToken] = useState<string | null>(null);
  const [result, setResult] = useState<{ name: string; status: 'approved' | 'pending' }[]>([]);
  const [error, setError] = useState<{ text: string; fields: Record<string, string> } | null>(null);
  const [busy, setBusy] = useState(false);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<PageInfo>(`/public/register/${code}`)
      .then(setInfo)
      .catch(() => setMissing(true));
  }, [code]);
  useEffect(() => {
    top.current?.scrollIntoView({ block: 'start' });
  }, [step]);

  const name = `${person.preferredName || person.firstName} ${person.lastName}`.trim();

  function finish(status: 'approved' | 'pending', token: string | null) {
    setResult((r) => [...r, { name, status }]);
    if (token) setContactToken(token);
    setStep('done');
    setCodeValue('');
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError({ text: message(err), fields: err instanceof ApiFailure ? err.fieldErrors() : {} });
    } finally {
      setBusy(false);
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const res = await api<{ status: 'confirm' | 'approved' | 'pending'; requestId: string; contactToken?: string }>(`/public/register/${code}`, {
        body: { ...personBody(person), email, ...(contactToken ? { contactToken } : {}) },
      });
      if (res.status === 'confirm') {
        setRequestId(res.requestId);
        setStep('code');
      } else {
        finish(res.status, res.contactToken ?? null);
      }
    });
  };

  const confirm = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const res = await api<{ status: 'approved' | 'pending'; contactToken: string }>(`/public/register/${code}/confirm`, { body: { requestId, code: codeValue } });
      finish(res.status, res.contactToken);
    });
  };

  if (missing) {
    return (
      <Frame>
        <h1>Registration page not found</h1>
        <p className="lede">Check you have the whole link, or ask the event team for a new one.</p>
      </Frame>
    );
  }
  if (!info) {
    return (
      <Frame>
        <p className="lede">Loading…</p>
      </Frame>
    );
  }

  const e = info.event;
  return (
    <Frame event={e}>
      <div ref={top} />
      {!info.open && step === 'form' ? (
        <Notice tone="warn" title={info.closedMessage ?? 'Registration is closed.'}>
          <p>Contact the event team if you need to make changes.</p>
        </Notice>
      ) : step === 'form' ? (
        <form onSubmit={submit} noValidate>
          <h1>{result.length ? 'Register someone else' : 'Register'}</h1>
          <p className="lede">
            {info.approval === 'manual'
              ? 'The event team checks each registration and confirms by email.'
              : 'You will get an email to confirm the registration.'}
            {info.closesOn && ` Registrations close ${formatDateRange(info.closesOn, info.closesOn)}.`}
          </p>
          {error && <Notice tone="stop">{error.text}</Notice>}
          <PersonFields value={person} onChange={setPerson} askPhotos={info.asksPhotos} askDietary={info.asksDietary} errors={error?.fields} />
          <Field
            id="reg-email"
            label="Your email address"
            hint={person.kind === 'youth' ? 'A parent or guardian. Only used for this registration.' : 'Only used for this registration.'}
            error={error?.fields.email}
          >
            <input
              id="reg-email"
              className="input"
              type="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              disabled={Boolean(contactToken)}
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
            />
          </Field>
          <button className="btn btn-block section-gap-sm" disabled={busy || !personReady(person, info.asksPhotos) || !email.includes('@')}>
            {busy ? 'Sending…' : `Register ${person.preferredName || person.firstName || ''}`.trim()}
          </button>
        </form>
      ) : step === 'code' ? (
        <form onSubmit={confirm} noValidate>
          <h1>Check your email</h1>
          <p className="lede">
            We've sent a 6-digit code to <strong>{email}</strong> to confirm registering {name}. It expires in 15 minutes. Check your junk folder
            too.
          </p>
          {error && <Notice tone="stop">{error.text}</Notice>}
          <Field id="reg-code" label="Code">
            <input
              id="reg-code"
              className="input input-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              value={codeValue}
              onChange={(ev) => setCodeValue(ev.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <button className="btn btn-block" disabled={busy || codeValue.length !== 6}>
            {busy ? 'Checking…' : 'Confirm'}
          </button>
          <div className="actions">
            <button type="button" className="btn-link" onClick={() => setStep('form')}>
              Back to the form
            </button>
          </div>
        </form>
      ) : (
        <>
          <h1>Thank you</h1>
          <ul className="list">
            {result.map((r, i) => (
              <li key={i} className="list-row">
                <span className="list-main">
                  <strong>{r.name}</strong>
                  <span>{r.status === 'approved' ? 'Registered' : 'Received. The event team will confirm by email.'}</span>
                </span>
                <span className={r.status === 'approved' ? 'tag tag-now' : 'tag'}>{r.status === 'approved' ? 'Registered' : 'Waiting'}</span>
              </li>
            ))}
          </ul>
          <div className="actions">
            <button
              className="btn btn-secondary"
              onClick={() => {
                // Keep the group and contact details for brothers and sisters.
                setPerson({ ...EMPTY_PERSON, groupName: person.groupName, kind: person.kind, section: person.section });
                setStep('form');
              }}
            >
              Register someone else
            </button>
          </div>
        </>
      )}
    </Frame>
  );
}

function Frame({ event, children }: { event?: PageInfo['event']; children: ReactNode }) {
  return (
    <div className="signin register">
      <div className="signin-band">
        <p className="wordmark">{event ? event.name : 'CampCount'}</p>
        {event && (
          <p>
            {formatDateRange(event.startsOn, event.endsOn)}
            {event.location && `, ${event.location}`}
          </p>
        )}
        {event?.description && <p className="register-about">{event.description}</p>}
      </div>
      <main className="signin-body">{children}</main>
    </div>
  );
}
