import { useState } from 'react';
import type { DietaryEntryInput } from '../../shared/schemas';
import { Badge, Button, Choice, Field } from '../ui';

export const CATEGORY_LABEL: Record<DietaryEntryInput['category'], string> = {
  allergy: 'Allergy',
  intolerance: 'Intolerance',
  medical_diet: 'Medical diet',
  religious_cultural: 'Religious or cultural',
  preference: 'Preference',
};

const QUICK: DietaryEntryInput[] = [
  { category: 'preference', item: 'Vegetarian', severity: 'standard', note: '' },
  { category: 'preference', item: 'Vegan', severity: 'standard', note: '' },
  { category: 'religious_cultural', item: 'Halal', severity: 'standard', note: '' },
  { category: 'medical_diet', item: 'Gluten free (coeliac)', severity: 'standard', note: '' },
  { category: 'intolerance', item: 'Lactose', severity: 'standard', note: '' },
  { category: 'allergy', item: 'Peanut', severity: 'standard', note: '' },
  { category: 'allergy', item: 'Tree nuts', severity: 'standard', note: '' },
];

export function describeEntry(e: DietaryEntryInput): string {
  return `${CATEGORY_LABEL[e.category]}: ${e.item}${e.severity === 'anaphylactic' ? ' (anaphylactic)' : ''}${e.note ? `, ${e.note}` : ''}`;
}

/**
 * Structured dietary entry. `value` undefined means "not reviewed yet";
 * an empty array means "reviewed: no dietary requirement".
 */
export function DietaryEditor({
  value,
  onChange,
  labelPrefix,
}: {
  value: DietaryEntryInput[] | undefined;
  onChange: (entries: DietaryEntryInput[]) => void;
  labelPrefix: string;
}) {
  const [draft, setDraft] = useState<DietaryEntryInput>({ category: 'allergy', item: '', severity: 'standard', note: '' });
  const entries = value ?? [];
  const id = labelPrefix.replace(/\W+/g, '-').toLowerCase();
  const add = (e: DietaryEntryInput) => {
    if (!entries.some((x) => x.category === e.category && x.item.toLowerCase() === e.item.toLowerCase())) onChange([...entries, e]);
  };

  return (
    <div className="dietary-editor">
      {entries.length > 0 && (
        <ul className="list" aria-label={`Dietary needs for ${labelPrefix}`}>
          {entries.map((e, i) => (
            <li key={i} className="row">
              {e.category === 'allergy' && <Badge tone="error">{e.severity === 'anaphylactic' ? 'Anaphylactic' : 'Allergy'}</Badge>}
              <span className="row-main">{describeEntry(e)}</span>
              <span className="row-side">
                {e.category === 'allergy' && (
                  <Button
                    small
                    kind="ghost"
                    onClick={() => onChange(entries.map((x, j) => (j === i ? { ...x, severity: x.severity === 'anaphylactic' ? 'standard' : 'anaphylactic' } : x)))}
                  >
                    {e.severity === 'anaphylactic' ? 'Not anaphylactic' : 'Anaphylactic'}
                  </Button>
                )}
                <Button small kind="ghost" aria-label={`Remove ${describeEntry(e)}`} onClick={() => onChange(entries.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {value !== undefined && entries.length === 0 && <p className="meta">Checked: no dietary needs.</p>}

      <div className="quick-picks" role="group" aria-label={`Common needs for ${labelPrefix}`}>
        {QUICK.map((q) => (
          <Button key={q.item} small onClick={() => add(q)}>
            {q.item}
          </Button>
        ))}
        <Button small onClick={() => onChange([])}>
          No dietary needs
        </Button>
      </div>

      <details className="more-options">
        <summary>Add something else</summary>
        <div className="form">
          <div className="field-pair">
            <Field id={`${id}-cat`} label="Type">
              <select className="select" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as DietaryEntryInput['category'] })}>
                {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`${id}-item`} label="Food">
              <input className="input" maxLength={60} value={draft.item} onChange={(e) => setDraft({ ...draft, item: e.target.value })} />
            </Field>
          </div>
          <Field id={`${id}-note`} label="Note for the kitchen" optional>
            <input className="input" maxLength={80} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
          </Field>
          {draft.category === 'allergy' && (
            <Choice
              label="Anaphylactic"
              description="Shown as a high-priority alert at every meal scan"
              checked={draft.severity === 'anaphylactic'}
              onChange={(e) => setDraft({ ...draft, severity: e.target.checked ? 'anaphylactic' : 'standard' })}
            />
          )}
          <div>
            <Button
              disabled={!draft.item.trim()}
              onClick={() => {
                add({ ...draft, item: draft.item.trim(), note: draft.note.trim() });
                setDraft({ category: 'allergy', item: '', severity: 'standard', note: '' });
              }}
            >
              Add dietary need
            </Button>
          </div>
        </div>
      </details>
    </div>
  );
}
