import type { DietaryEntryInput } from '../../shared/schemas';
import { DietaryEditor } from './DietaryEditor';
import { Choice, Field, Segmented } from '../ui';

export interface PersonForm {
  kind: 'youth' | 'adult';
  section: string;
  firstName: string;
  preferredName: string;
  lastName: string;
  memberNumber: string;
  notMember: boolean;
  groupName: string;
  position: string;
  photoConsent: 'yes' | 'no' | 'unknown';
  dietary: DietaryEntryInput[];
}

export const EMPTY_PERSON: PersonForm = {
  kind: 'youth',
  section: 'Cubs',
  firstName: '',
  preferredName: '',
  lastName: '',
  memberNumber: '',
  notMember: false,
  groupName: '',
  position: '',
  photoConsent: 'unknown',
  dietary: [],
};

export const YOUTH_SECTIONS = ['Joeys', 'Cubs', 'Scouts', 'Venturers', 'Rovers'];

/** What the server expects for one person. */
export function personBody(p: PersonForm) {
  return {
    kind: p.kind,
    section: p.kind === 'adult' ? 'Leaders' : p.section,
    firstName: p.firstName,
    preferredName: p.preferredName,
    lastName: p.lastName,
    memberNumber: p.notMember ? null : p.memberNumber.trim(),
    groupName: p.groupName,
    position: p.kind === 'adult' ? p.position : '',
    photoConsent: p.photoConsent,
    dietary: p.dietary,
  };
}

export function personReady(p: PersonForm, askPhotos: boolean): boolean {
  return Boolean(p.firstName.trim() && p.lastName.trim() && (p.notMember || p.memberNumber.trim()) && (!askPhotos || p.photoConsent !== 'unknown'));
}

/** The questions for one person, shared by "Add person" and the sign-up kiosk. */
export function PersonFields({
  value,
  onChange,
  askPhotos,
  askDietary,
  errors = {},
  youthLabel = 'A young person',
  adultLabel = 'A leader or helper',
}: {
  value: PersonForm;
  onChange: (next: PersonForm) => void;
  askPhotos: boolean;
  askDietary: boolean;
  errors?: Record<string, string>;
  youthLabel?: string;
  adultLabel?: string;
}) {
  const set = <K extends keyof PersonForm>(k: K, v: PersonForm[K]) => onChange({ ...value, [k]: v });
  const name = value.preferredName || value.firstName || 'them';
  return (
    <>
      <div className="field">
        <span className="field-label" id="pf-kind">
          Who are you adding?
        </span>
        <Segmented
          block
          label="Who are you adding?"
          value={value.kind}
          onChange={(k) => set('kind', k)}
          options={[
            { value: 'youth', label: youthLabel },
            { value: 'adult', label: adultLabel },
          ]}
        />
      </div>

      {value.kind === 'youth' && (
        <Field id="pf-section" label="Section">
          <select className="select" value={value.section} onChange={(e) => set('section', e.target.value)}>
            {YOUTH_SECTIONS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
      )}

      <div className="field-pair">
        <Field id="pf-first" label="First name" error={errors.firstName}>
          <input className="input" autoComplete="off" value={value.firstName} onChange={(e) => set('firstName', e.target.value)} />
        </Field>
        <Field id="pf-last" label="Last name" error={errors.lastName}>
          <input className="input" autoComplete="off" value={value.lastName} onChange={(e) => set('lastName', e.target.value)} />
        </Field>
      </div>
      <Field id="pf-pref" label="Goes by" optional hint="If they use a different first name. It goes on their lanyard.">
        <input className="input" autoComplete="off" value={value.preferredName} onChange={(e) => set('preferredName', e.target.value)} />
      </Field>
      <div className="field">
        <Field id="pf-member" label="Scouts membership number" error={errors.memberNumber}>
          <input
            className="input"
            inputMode="numeric"
            autoComplete="off"
            disabled={value.notMember}
            value={value.notMember ? '' : value.memberNumber}
            onChange={(e) => set('memberNumber', e.target.value)}
          />
        </Field>
        <Choice
          label="Not a Scouts member"
          description="For example a parent helper or visitor"
          checked={value.notMember}
          onChange={(e) => set('notMember', e.target.checked)}
        />
      </div>
      <Field id="pf-group" label="Scout group" optional hint="For example, Red Gum Cub Pack">
        <input className="input" autoComplete="off" value={value.groupName} onChange={(e) => set('groupName', e.target.value)} />
      </Field>
      {value.kind === 'adult' && (
        <Field id="pf-position" label="Role" optional hint="For example, Cub Leader, cook, first aider">
          <input className="input" autoComplete="off" value={value.position} onChange={(e) => set('position', e.target.value)} />
        </Field>
      )}

      {askPhotos && (
        <div className="field">
          <span className="field-label">Can {name} be in photos?</span>
          <Segmented
            block
            label={`Can ${name} be in photos?`}
            value={value.photoConsent}
            onChange={(v) => set('photoConsent', v)}
            options={[
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No photos' },
            ]}
          />
        </div>
      )}

      {askDietary && (
        <fieldset className="field">
          <legend className="field-label">Food needs</legend>
          <span className="field-hint">Allergies, intolerances and diets only. Tell the event team about any other medical needs directly.</span>
          <DietaryEditor value={value.dietary} onChange={(d) => set('dietary', d)} labelPrefix={name} />
        </fieldset>
      )}
    </>
  );
}
