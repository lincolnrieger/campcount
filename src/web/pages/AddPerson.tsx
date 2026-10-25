import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ApiFailure, api } from '../api';
import { useToast } from '../components/Toast';
import { useTitle } from '../useTitle';
import { EMPTY_PERSON, PersonFields, personBody, personReady } from '../components/PersonFields';
import type { PersonForm } from '../components/PersonFields';
import { BackLink, Notice } from '../components/ui';
import { useEvent } from './EventLayout';

/** Event managers add one person by hand; they go straight on the roster with a card. */
export function AddPerson() {
  useTitle('Add person');
  const { event } = useEvent();
  const navigate = useNavigate();
  const toast = useToast();
  const [person, setPerson] = useState<PersonForm>(EMPTY_PERSON);
  const [error, setError] = useState<{ text: string; fields: Record<string, string> } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ registrationId: string }>(`/events/${event.id}/registrations`, { body: personBody(person) });
      navigate(`../${res.registrationId}`, { relative: 'path', replace: true });
      toast(`Added ${person.preferredName || person.firstName} ${person.lastName}.`);
    } catch (err) {
      setError({ text: err instanceof ApiFailure ? err.message : 'Something went wrong.', fields: err instanceof ApiFailure ? err.fieldErrors() : {} });
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="narrow">
      <BackLink to=".." label="People" />
      <h2>Add person</h2>
      <p className="lede">They join the roster straight away and get a lanyard card. For lots of people, import from MyScout instead.</p>
      {error && <Notice tone="stop">{error.text}</Notice>}
      <PersonFields
        value={person}
        onChange={setPerson}
        askPhotos={event.features.photo}
        askDietary={event.features.dietary}
        errors={error?.fields}
        youthLabel="Youth"
        adultLabel="Leader or helper"
      />
      <div className="actions">
        <button className="btn" disabled={busy || !personReady(person, false)}>
          {busy ? 'Adding…' : 'Add person'}
        </button>
      </div>
    </form>
  );
}
