import { useId } from 'react';
import { SECTION_COLOUR, SECTION_COLOURS, SECTION_TEXT_COLOUR } from '../../shared/lanyardDesign';

const BASICS = ['#FFFFFF', '#000000', '#16201B', '#45514C', '#1F5C46', '#00843D', '#7A1F3D', '#C8102E', '#1F5FA8', '#F2B705', '#E8601C'];

/**
 * Pick a colour: common swatches, "follows the section", or any colour.
 * Every swatch has a name for screen readers.
 */
export function ColourField({
  label,
  value,
  onChange,
  allowNone,
  section,
  extra,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  allowNone?: boolean;
  /** Offer the section colour ('fill') or the text colour that reads on it ('text'). */
  section?: 'fill' | 'text';
  /** The camp's own colour, if it has one. */
  extra?: string | null;
}) {
  const id = useId();
  const swatches = [...new Set([...(extra ? [extra.toUpperCase()] : []), ...BASICS])];
  const hex = /^#[0-9A-Fa-f]{6}$/.test(value) ? value.toUpperCase() : null;
  const sectionValue = section === 'text' ? SECTION_TEXT_COLOUR : SECTION_COLOUR;
  return (
    <fieldset className="colour-field">
      <legend className="studio-label">{label}</legend>
      <div className="swatches">
        {allowNone && (
          <button type="button" className="swatch swatch-none" aria-pressed={value === 'none'} onClick={() => onChange('none')} title="None">
            <span className="visually-hidden">None</span>
          </button>
        )}
        {section && (
          <button
            type="button"
            className="swatch swatch-section"
            aria-pressed={value === sectionValue}
            onClick={() => onChange(sectionValue)}
            title={section === 'text' ? 'Reads on the section colour' : 'Section colour (Scout green, Venturer maroon, Rover red, Leader eucalypt)'}
            style={{ background: `conic-gradient(${Object.values(SECTION_COLOURS).map((c, i, a) => `${c.bg} ${(i / a.length) * 360}deg ${((i + 1) / a.length) * 360}deg`).join(', ')})` }}
          >
            <span className="visually-hidden">{section === 'text' ? 'Text colour for the section' : 'Section colour'}</span>
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
          placeholder={value === SECTION_COLOUR ? 'Section colour' : value === SECTION_TEXT_COLOUR ? 'Section text colour' : value === 'none' ? 'None' : '#000000'}
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
