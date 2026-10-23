import { useState } from 'react';
import type { DietaryEntryInput } from '../../shared/schemas';

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
  const add = (e: DietaryEntryInput) => {
    if (!entries.some((x) => x.category === e.category && x.item.toLowerCase() === e.item.toLowerCase())) onChange([...entries, e]);
  };

  return (
    <div className="dietary-editor">
      {entries.length > 0 && (
        <ul className="chips" aria-label={`Dietary requirements for ${labelPrefix}`}>
          {entries.map((e, i) => (
            <li key={i} className={e.category === 'allergy' ? 'chip chip-alert' : 'chip'}>
              {describeEntry(e)}
              {e.category === 'allergy' && (
                <button
                  type="button"
                  className="btn-link"
                  onClick={() =>
                    onChange(
                      entries.map((x, j) =>
                        j === i ? { ...x, severity: x.severity === 'anaphylactic' ? 'standard' : 'anaphylactic' } : x,
                      ),
                    )
                  }
                >
                  {e.severity === 'anaphylactic' ? 'Not anaphylactic' : 'Mark anaphylactic'}
                </button>
              )}
              <button
                type="button"
                className="btn-link"
                aria-label={`Remove ${describeEntry(e)}`}
                onClick={() => onChange(entries.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {value !== undefined && entries.length === 0 && <p className="field-hint">Reviewed: no dietary requirement.</p>}

      <div className="quick-picks" role="group" aria-label={`Common requirements for ${labelPrefix}`}>
        {QUICK.map((q) => (
          <button key={q.item} type="button" className="btn btn-secondary btn-small" onClick={() => add(q)}>
            {q.item}
          </button>
        ))}
        <button type="button" className="btn btn-secondary btn-small" onClick={() => onChange([])}>
          No dietary requirement
        </button>
      </div>

      <details>
        <summary>Add something else</summary>
        <div className="row">
          <div className="field">
            <label htmlFor={`${labelPrefix}-cat`}>Type</label>
            <select
              id={`${labelPrefix}-cat`}
              className="input"
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value as DietaryEntryInput['category'] })}
            >
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${labelPrefix}-item`}>Food</label>
            <input
              id={`${labelPrefix}-item`}
              className="input"
              maxLength={60}
              value={draft.item}
              onChange={(e) => setDraft({ ...draft, item: e.target.value })}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor={`${labelPrefix}-note`}>Note for the kitchen (optional)</label>
          <input
            id={`${labelPrefix}-note`}
            className="input"
            maxLength={80}
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          />
        </div>
        {draft.category === 'allergy' && (
          <label className="check">
            <input
              type="checkbox"
              checked={draft.severity === 'anaphylactic'}
              onChange={(e) => setDraft({ ...draft, severity: e.target.checked ? 'anaphylactic' : 'standard' })}
            />
            <div>
              <strong>Anaphylactic</strong>
              <span>Shown as a high-priority alert at every meal scan.</span>
            </div>
          </label>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!draft.item.trim()}
          onClick={() => {
            add({ ...draft, item: draft.item.trim(), note: draft.note.trim() });
            setDraft({ category: 'allergy', item: '', severity: 'standard', note: '' });
          }}
        >
          Add
        </button>
      </details>
    </div>
  );
}
