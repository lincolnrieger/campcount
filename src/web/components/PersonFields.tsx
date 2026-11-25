import { ROLE_LABEL } from '../../shared/roles';
import type { Role } from '../../shared/roles';
import { Field, Segmented } from '../ui';

export interface PersonForm {
  firstName: string;
  lastName: string;
  /** Empty: CampCount makes one. */
  participantId: string;
  kind: Role;
}

export const EMPTY_PERSON: PersonForm = {
  firstName: '',
  lastName: '',
  participantId: '',
  kind: 'youth',
};

/** What the server expects for one person. */
export function personBody(p: PersonForm) {
  return {
    kind: p.kind,
    firstName: p.firstName.trim(),
    lastName: p.lastName.trim(),
    participantId: p.participantId.trim() || null,
  };
}

/** The questions for one person ("Add person"): name, participant ID and role. Nothing else is kept. */
export function PersonFields({ value, onChange, errors = {} }: { value: PersonForm; onChange: (next: PersonForm) => void; errors?: Record<string, string> }) {
  const set = <K extends keyof PersonForm>(k: K, v: PersonForm[K]) => onChange({ ...value, [k]: v });
  return (
    <>
      <div className="field-pair">
        <Field id="pf-first" label="First name" error={errors.firstName} hint="Or just an initial">
          <input className="input" autoComplete="off" value={value.firstName} onChange={(e) => set('firstName', e.target.value)} />
        </Field>
        <Field id="pf-last" label="Last name" optional error={errors.lastName} hint="Or just an initial">
          <input className="input" autoComplete="off" value={value.lastName} onChange={(e) => set('lastName', e.target.value)} />
        </Field>
      </div>
      <Field id="pf-member" label="Participant ID" optional error={errors.participantId} hint="Leave blank and CampCount makes one. It's the typed code on their lanyard.">
        <input className="input" autoComplete="off" value={value.participantId} onChange={(e) => set('participantId', e.target.value)} />
      </Field>
      <div className="field">
        <span className="field-label">Role</span>
        <Segmented
          block
          label="Role"
          value={value.kind}
          onChange={(v) => set('kind', v)}
          options={[
            { value: 'youth', label: ROLE_LABEL.youth },
            { value: 'adult', label: ROLE_LABEL.adult },
          ]}
        />
      </div>
    </>
  );
}
