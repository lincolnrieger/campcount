import type { DietaryEntryInput } from '../../shared/schemas';
import type { LevelSetting } from '../../shared/levels';
import { kindForLevel } from '../../shared/levels';
import { DietaryEditor } from './DietaryEditor';
import { Field, Segmented } from '../ui';

export interface PersonForm {
  level: string;
  firstName: string;
  lastName: string;
  /** Empty: CampCount makes one. */
  participantId: string;
  groupName: string;
  photoConsent: 'yes' | 'no';
  dietary: DietaryEntryInput[];
}

export const EMPTY_PERSON: PersonForm = {
  level: '',
  firstName: '',
  lastName: '',
  participantId: '',
  groupName: '',
  photoConsent: 'no',
  dietary: [],
};

/** What the server expects for one person. */
export function personBody(p: PersonForm, levels: readonly LevelSetting[]) {
  const level = p.level || levels[0]?.name || 'Participants';
  return {
    kind: kindForLevel(level, levels),
    level,
    firstName: p.firstName.trim(),
    lastName: p.lastName.trim(),
    participantId: p.participantId.trim() || null,
    groupName: p.groupName.trim(),
    photoConsent: p.photoConsent,
    dietary: p.dietary,
  };
}

/** The questions for one person ("Add person"): only what CampCount keeps. */
export function PersonFields({
  value,
  onChange,
  askPhotos,
  askDietary,
  levels,
  errors = {},
}: {
  value: PersonForm;
  onChange: (next: PersonForm) => void;
  askPhotos: boolean;
  askDietary: boolean;
  /** The camp's levels (Settings › Levels). */
  levels: readonly LevelSetting[];
  errors?: Record<string, string>;
}) {
  const set = <K extends keyof PersonForm>(k: K, v: PersonForm[K]) => onChange({ ...value, [k]: v });
  const name = value.firstName || 'them';
  const level = value.level || levels[0]?.name || '';
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
      <Field id="pf-level" label="Level">
        <select className="select" value={level} onChange={(e) => set('level', e.target.value)}>
          {levels.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
              {s.youth ? '' : ' (adults)'}
            </option>
          ))}
        </select>
      </Field>
      <Field id="pf-member" label="Participant ID" optional error={errors.participantId} hint="Leave blank and CampCount makes one. It's the typed code on their lanyard.">
        <input className="input" autoComplete="off" value={value.participantId} onChange={(e) => set('participantId', e.target.value)} />
      </Field>
      <Field id="pf-group" label="Group" optional>
        <input className="input" autoComplete="off" value={value.groupName} onChange={(e) => set('groupName', e.target.value)} />
      </Field>

      {askPhotos && (
        <div className="field">
          <span className="field-label">Photo consent</span>
          <Segmented
            block
            label={`Can ${name} be in photos?`}
            value={value.photoConsent}
            onChange={(v) => set('photoConsent', v)}
            options={[
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
            ]}
          />
        </div>
      )}

      {askDietary && (
        <fieldset className="field">
          <legend className="field-label">Dietaries</legend>
          <span className="field-hint">Allergies, intolerances and diets only. Other medical details aren't kept in CampCount.</span>
          <DietaryEditor value={value.dietary} onChange={(d) => set('dietary', d)} labelPrefix={name} />
        </fieldset>
      )}
    </>
  );
}
