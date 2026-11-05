import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ApiFailure, api } from '../api';
import { EMPTY_PERSON, PersonFields, personBody } from '../components/PersonFields';
import type { PersonForm } from '../components/PersonFields';
import { Button, ErrorSummary, PageHeader, useToast } from '../ui';
import { useEvent } from './EventLayout';

const FIELD_LABEL: Record<string, string> = { firstName: 'pf-first', lastName: 'pf-last', memberNumber: 'pf-member' };

/** People › Add person: one person by hand. They go straight on the event with a lanyard. */
export function AddPerson() {
  const { event } = useEvent();
  const { base: eventBase } = useEvent();
  const navigate = useNavigate();
  const toast = useToast();
  const [person, setPerson] = useState<PersonForm>(EMPTY_PERSON);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const people = `${eventBase}/people`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!person.firstName.trim()) local.firstName = 'Enter their first name';
    if (!person.lastName.trim()) local.lastName = 'Enter their last name';
    if (!person.notMember && !person.memberNumber.trim()) local.memberNumber = 'Enter their membership number, or tick "Not a Scouts member"';
    setErrors(local);
    setFailure(null);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      const res = await api<{ registrationId?: string }>(`/events/${event.id}/registrations`, { body: personBody(person) });
      toast(`Added ${person.preferredName || person.firstName} ${person.lastName}`);
      navigate(res.registrationId ? `${people}/${res.registrationId}` : people, { replace: true });
    } catch (err) {
      if (err instanceof ApiFailure) {
        setErrors(err.fieldErrors());
        setFailure(err.message);
      } else setFailure('No connection. Check your signal and try again.');
      setBusy(false);
    }
  }

  const summary = [
    ...Object.entries(errors)
      .filter(([k]) => FIELD_LABEL[k])
      .map(([k, message]) => ({ id: FIELD_LABEL[k]!, message })),
    ...(failure && Object.keys(errors).length === 0 ? [{ id: 'pf-first', message: failure }] : []),
  ];

  return (
    <>
      <PageHeader title="Add person" back={{ to: people, label: 'People' }} summary="They join the event straight away and get a lanyard. For lots of people, import from MyScout instead." />
      <form className="form" onSubmit={submit} noValidate>
        <ErrorSummary errors={summary} />
        <PersonFields
          value={person}
          onChange={setPerson}
          askPhotos={event.features.photo}
          askDietary={event.features.dietary}
          errors={errors}
          youthLabel="Youth"
          adultLabel="Leader or helper"
        />
        <div className="btn-row">
          <Button type="submit" kind="primary" busy={busy} busyLabel="Adding…">
            Add person
          </Button>
          <Button onClick={() => navigate(people)}>Cancel</Button>
        </div>
      </form>
    </>
  );
}
