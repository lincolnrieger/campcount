import type { DietaryEntryInput } from '../../shared/schemas';
import { DietaryEditor } from './DietaryEditor';
import { Field } from './ui';

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

/** The questions for one person, shared by the public registration page and "Add person". */
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
      <div className="segmented" role="group" aria-label="Who is coming">
        <button type="button" aria-pressed={value.kind === 'youth'} onClick={() => set('kind', 'youth')}>
          {youthLabel}
        </button>
        <button type="button" aria-pressed={value.kind === 'adult'} onClick={() => set('kind', 'adult')}>
          {adultLabel}
        </button>
      </div>

      {value.kind === 'youth' && (
        <div className="field section-gap-sm">
          <span className="field-legend" id="pf-section">
            Section
          </span>
          <div className="chip-row" role="group" aria-labelledby="pf-section">
            {YOUTH_SECTIONS.map((s) => (
              <button key={s} type="button" aria-pressed={value.section === s} className="chip-toggle" onClick={() => set('section', s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="row section-gap-sm">
        <Field id="pf-first" label="First name" error={errors.firstName}>
          <input id="pf-first" className="input" autoComplete="off" value={value.firstName} onChange={(e) => set('firstName', e.target.value)} />
        </Field>
        <Field id="pf-last" label="Last name" error={errors.lastName}>
          <input id="pf-last" className="input" autoComplete="off" value={value.lastName} onChange={(e) => set('lastName', e.target.value)} />
        </Field>
      </div>
      <Field id="pf-pref" label="Goes by (optional)" hint="If they use a different first name. It goes on their lanyard.">
        <input id="pf-pref" className="input" autoComplete="off" value={value.preferredName} onChange={(e) => set('preferredName', e.target.value)} />
      </Field>
      <Field id="pf-member" label="Scouts membership number" error={errors.memberNumber}>
        <input
          id="pf-member"
          className="input"
          inputMode="numeric"
          autoComplete="off"
          disabled={value.notMember}
          value={value.notMember ? '' : value.memberNumber}
          onChange={(e) => set('memberNumber', e.target.value)}
        />
      </Field>
      <label className="check check-compact">
        <input type="checkbox" checked={value.notMember} onChange={(e) => set('notMember', e.target.checked)} />
        <div>
          <strong>Not a Scouts member</strong>
          <span>For example a parent helper or visitor.</span>
        </div>
      </label>
      <Field id="pf-group" label="Scout group" hint="For example, Red Gum Cub Pack">
        <input id="pf-group" className="input" autoComplete="off" value={value.groupName} onChange={(e) => set('groupName', e.target.value)} />
      </Field>
      {value.kind === 'adult' && (
        <Field id="pf-position" label="Role (optional)" hint="For example, Cub Leader, cook, first aider">
          <input id="pf-position" className="input" autoComplete="off" value={value.position} onChange={(e) => set('position', e.target.value)} />
        </Field>
      )}

      {askPhotos && (
        <div className="field">
          <span className="field-legend" id="pf-photo">
            Can {name} be in photos?
          </span>
          <div className="chip-row" role="group" aria-labelledby="pf-photo">
            <button type="button" aria-pressed={value.photoConsent === 'yes'} className="chip-toggle" onClick={() => set('photoConsent', 'yes')}>
              Yes
            </button>
            <button type="button" aria-pressed={value.photoConsent === 'no'} className="chip-toggle" onClick={() => set('photoConsent', 'no')}>
              No photos
            </button>
          </div>
        </div>
      )}

      {askDietary && (
        <div className="field">
          <span className="field-legend">Food needs</span>
          <span className="field-hint">
            Allergies, intolerances and diets only. Please tell the event team about any other medical needs directly.
          </span>
          <DietaryEditor value={value.dietary} onChange={(d) => set('dietary', d)} labelPrefix={name} />
        </div>
      )}
    </>
  );
}
