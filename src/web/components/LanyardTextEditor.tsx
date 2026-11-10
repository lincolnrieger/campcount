import { useState } from 'react';
import type { CardTextLayout, TextPlacement } from '../../shared/schemas';
import type { Card, CardSize, PhotoMarkerStyle } from '../lanyards/pdf';
import { CARD_SIZES, PT_MM, clampToCard, defaultTextLayout } from '../lanyards/pdf';
import { Button, Choice, Field, Segmented } from '../ui';
import type { LayoutPart } from './LanyardCard';
import { CustomFront } from './LanyardCard';

const PARTS: { value: LayoutPart; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'role', label: 'Leader or youth' },
  { value: 'group', label: 'Group' },
  { value: 'qr', label: 'QR code' },
  { value: 'code', label: 'Typed code' },
];

const YOUTH: Card = {
  registrationId: 'sample-youth',
  name: 'Sam Taylor',
  kind: 'youth',
  section: 'Scouts',
  groupName: '1st Example Scout Group',
  shortCode: 'K7QM-3XRP',
  qr: 'https://campcount.com/c#sample-card-preview-only',
};
const LEADER: Card = { ...YOUTH, registrationId: 'sample-leader', name: 'Alex Morgan-Williams', kind: 'adult', section: 'Leaders', shortCode: 'P4TV-8NWC' };

/** A number box in millimetres or points. Keeps what's typed until it's a number, then clamps it. */
function NumberField({ id, label, value, min, max, step = 0.5, unit, onChange }: { id: string; label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Field id={id} label={`${label} (${unit})`}>
      <input
        className="input input-number"
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={draft ?? String(value)}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number.parseFloat(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n * 10) / 10)));
        }}
        onBlur={() => setDraft(null)}
      />
    </Field>
  );
}

/**
 * Settings › Lanyards › Text on the card: drag the name, leader-or-youth
 * word, group, QR code and typed code on a preview of the card, and choose
 * each one's colour, size and alignment.
 */
export function LanyardTextEditor({
  size,
  layout,
  onChange,
  marker,
  artwork,
  disabled,
}: {
  size: CardSize;
  layout: CardTextLayout;
  onChange: (layout: CardTextLayout) => void;
  marker: PhotoMarkerStyle;
  artwork: string | null;
  disabled?: boolean;
}) {
  const [part, setPart] = useState<LayoutPart>('name');
  const [who, setWho] = useState<'youth' | 'adult'>('youth');
  const spec = CARD_SIZES[size];
  const id = (k: string) => `layout-${size}-${part}-${k}`;

  const setText = (key: Exclude<LayoutPart, 'qr'>, patch: Partial<TextPlacement>) => {
    const current = layout[key];
    const next = { ...current, ...patch };
    // Keep the line on the card when it grows or moves.
    const kept = clampToCard(size, next.x, next.y, Math.min(next.w, spec.w), next.size * PT_MM);
    onChange({ ...layout, [key]: { ...next, ...kept, w: Math.min(next.w, spec.w - kept.x) } });
  };
  const move = (p: LayoutPart, x: number, y: number) => {
    if (disabled) return;
    if (p === 'qr') onChange({ ...layout, qr: { ...layout.qr, x, y } });
    else onChange({ ...layout, [p]: { ...layout[p], x, y } });
  };

  const sample = { ...(who === 'adult' ? LEADER : YOUTH), noPhotos: true };
  const text = part === 'qr' ? null : layout[part];

  return (
    <div className="layout-editor">
      <div className="layout-editor-preview">
        <Segmented
          label="Preview as"
          value={who}
          onChange={setWho}
          options={[
            { value: 'youth', label: 'Youth' },
            { value: 'adult', label: 'Leader' },
          ]}
        />
        <div className={`layout-editor-card layout-editor-card-${size}`}>
          <CustomFront card={sample} size={size} marker={marker} artwork={artwork} layout={layout} edit={{ selected: part, onSelect: setPart, onMove: move }} />
        </div>
        <p className="meta">Drag anything on the card to move it. Or pick it, then use the arrow keys (hold Shift for bigger steps).</p>
      </div>

      <fieldset className="layout-editor-controls form" disabled={disabled}>
        <legend className="visually-hidden">Change one thing on the card</legend>
        <Field id={`layout-${size}-part`} label="Change">
          <select className="select" value={part} onChange={(e) => setPart(e.target.value as LayoutPart)}>
            {PARTS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>

        {part === 'qr' ? (
          <>
            <div className="field-trio">
              <NumberField id={id('x')} label="From left" unit="mm" value={layout.qr.x} min={0} max={spec.w - layout.qr.size} onChange={(x) => onChange({ ...layout, qr: { ...layout.qr, x } })} />
              <NumberField id={id('y')} label="From top" unit="mm" value={layout.qr.y} min={0} max={spec.h - layout.qr.size} onChange={(y) => onChange({ ...layout, qr: { ...layout.qr, y } })} />
              <NumberField
                id={id('size')}
                label="Size"
                unit="mm"
                value={layout.qr.size}
                min={15}
                max={Math.min(spec.w, spec.h, 90)}
                onChange={(n) => onChange({ ...layout, qr: { ...layout.qr, size: n, ...clampToCard(size, layout.qr.x, layout.qr.y, n, n) } })}
              />
            </div>
            <p className="meta">Keep the QR code at least {size === 'lanyard' ? 30 : 20} mm across so scanners read it easily. A white edge always prints around it.</p>
          </>
        ) : (
          text && (
            <>
              {part !== 'code' ? (
                <Choice label="Print this" checked={text.show} onChange={(e) => setText(part, { show: e.target.checked })} />
              ) : (
                <p className="meta">The typed code always prints, on a white strip, so it can be typed in if the QR code won't scan.</p>
              )}
              {part === 'role' && (
                <>
                  <div className="field-pair">
                    <Field id={id('adult-word')} label="Word for leaders">
                      <input className="input" maxLength={24} value={layout.role.adultWord} onChange={(e) => onChange({ ...layout, role: { ...layout.role, adultWord: e.target.value } })} />
                    </Field>
                    <Field id={id('youth-word')} label="Word for youth">
                      <input
                        className="input"
                        maxLength={24}
                        disabled={layout.role.youthUsesSection}
                        value={layout.role.youthWord}
                        onChange={(e) => onChange({ ...layout, role: { ...layout.role, youthWord: e.target.value } })}
                      />
                    </Field>
                  </div>
                  <Choice
                    label="Use their section for youth instead"
                    description="Prints Scout, Venturer or Rover from the roster."
                    checked={layout.role.youthUsesSection}
                    onChange={(e) => onChange({ ...layout, role: { ...layout.role, youthUsesSection: e.target.checked } })}
                  />
                </>
              )}
              <div className="field-pair">
                <NumberField id={id('size')} label="Font size" unit="pt" value={text.size} min={4} max={72} onChange={(n) => setText(part, { size: n })} />
                {part !== 'role' && (
                  <Field id={id('colour')} label="Colour">
                    <input className="input input-colour" type="color" value={text.colour} onChange={(e) => setText(part, { colour: e.target.value.toUpperCase() })} />
                  </Field>
                )}
              </div>
              {part === 'role' && (
                <div className="field-pair">
                  <Field id={id('colour')} label="Youth colour">
                    <input className="input input-colour" type="color" value={text.colour} onChange={(e) => setText(part, { colour: e.target.value.toUpperCase() })} />
                  </Field>
                  <Field id={id('adult-colour')} label="Leader colour">
                    <input
                      className="input input-colour"
                      type="color"
                      value={layout.role.adultColour}
                      onChange={(e) => onChange({ ...layout, role: { ...layout.role, adultColour: e.target.value.toUpperCase() } })}
                    />
                  </Field>
                </div>
              )}
              <div className="field">
                <span className="field-label">Line up</span>
                <Segmented
                  label="Line up"
                  value={text.align}
                  onChange={(align) => setText(part, { align })}
                  options={[
                    { value: 'left', label: 'Left' },
                    { value: 'centre', label: 'Centre' },
                    { value: 'right', label: 'Right' },
                  ]}
                />
              </div>
              <Choice label="Bold" checked={text.bold} onChange={(e) => setText(part, { bold: e.target.checked })} />
              <div className="field-trio">
                <NumberField id={id('x')} label="From left" unit="mm" value={text.x} min={0} max={spec.w - 5} onChange={(x) => setText(part, { x })} />
                <NumberField id={id('y')} label="From top" unit="mm" value={text.y} min={0} max={spec.h - text.size * PT_MM} onChange={(y) => setText(part, { y })} />
                <NumberField id={id('w')} label="Width" unit="mm" value={text.w} min={5} max={spec.w - text.x} onChange={(w) => setText(part, { w })} />
              </div>
              <p className="meta">Long names shrink to fit the width, down to about half the font size.</p>
            </>
          )
        )}
        <div className="btn-row">
          <Button small kind="ghost" onClick={() => onChange(defaultTextLayout(size))}>
            Start again from the built-in layout
          </Button>
        </div>
      </fieldset>
    </div>
  );
}
