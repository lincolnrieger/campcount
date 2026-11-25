import { useId } from 'react';
import { LEVEL_COLOUR, LEVEL_COLOURS, LEVEL_TEXT_COLOUR } from '../../shared/lanyardDesign';

const BASICS = ['#FFFFFF', '#000000', '#16201B', '#45514C', '#1F5C46', '#00843D', '#7A1F3D', '#C8102E', '#1F5FA8', '#F2B705', '#E8601C'];

/**
 * Pick a colour: common swatches, "follows the role", or any colour.
 * Every swatch has a name for screen readers.
 */
export function ColourField({
  label,
  value,
  onChange,
  allowNone,
  level,
  extra,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  allowNone?: boolean;
  /** Offer the role colour ('fill') or the text colour that reads on it ('text'). */
  level?: 'fill' | 'text';
  /** The camp's own colour, if it has one. */
  extra?: string | null;
}) {
  const id = useId();
  const swatches = [...new Set([...(extra ? [extra.toUpperCase()] : []), ...BASICS])];
  const hex = /^#[0-9A-Fa-f]{6}$/.test(value) ? value.toUpperCase() : null;
  const levelValue = level === 'text' ? LEVEL_TEXT_COLOUR : LEVEL_COLOUR;
  return (
    <fieldset className="colour-field">
      <legend className="studio-label">{label}</legend>
      <div className="swatches">
        {allowNone && (
          <button type="button" className="swatch swatch-none" aria-pressed={value === 'none'} onClick={() => onChange('none')} title="None">
            <span className="visually-hidden">None</span>
          </button>
        )}
        {level && (
          <button
            type="button"
            className="swatch swatch-section"
            aria-pressed={value === levelValue}
            onClick={() => onChange(levelValue)}
            title={level === 'text' ? 'Reads on the role colour' : 'Role colour (participants and leaders each have their own)'}
            style={{
              background: `conic-gradient(${Object.values(LEVEL_COLOURS)
                .map((c, i, a) => `${c.bg} ${(i / a.length) * 360}deg ${((i + 1) / a.length) * 360}deg`)
                .join(', ')})`,
            }}
          >
            <span className="visually-hidden">{level === 'text' ? 'Text colour for the role' : 'Role colour'}</span>
          </button>
        )}
        {swatches.map((c) => (
          <button key={c} type="button" className="swatch" aria-pressed={hex === c} onClick={() => onChange(c)} style={{ background: c }} title={c}>
            <span className="visually-hidden">{c}</span>
          </button>
        ))}
        <label className="swatch swatch-custom" title="Any colour">
          <span className="visually-hidden">Any colour</span>
          <input type="color" value={hex ?? '#1F5C46'} onChange={(e) => onChange(e.target.value.toUpperCase())} />
        </label>
      </div>
      <div className="colour-hex">
        <label htmlFor={id} className="visually-hidden">
          {label} as a hex code
        </label>
        <input
          id={id}
          key={value}
          className="input input-small"
          defaultValue={hex ?? ''}
          placeholder={value === LEVEL_COLOUR ? 'Role colour' : value === LEVEL_TEXT_COLOUR ? 'Role text colour' : value === 'none' ? 'None' : '#000000'}
          spellCheck={false}
          onChange={(e) => {
            const v = e.target.value.trim();
            if (/^#[0-9A-Fa-f]{6}$/.test(v)) onChange(v.toUpperCase());
          }}
          onFocus={(e) => e.target.select()}
        />
      </div>
    </fieldset>
  );
}
