import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import type { CardFormat, CardPerson, DesignElement, FieldId, FontId, FontWeight, ImageElement, LanyardDesign, Orientation, ShapeElement, SideKey, TextElement } from '../../shared/lanyardDesign';
import { CARD_FORMATS, CARD_FORMAT_KEYS, FIELDS, FIELD_IDS, FONTS, FONT_IDS, cardSize, designWarnings, fontWeight, starterDesign } from '../../shared/lanyardDesign';
import type { PhotoMarker } from '../../shared/schemas';
import { PHOTO_MARKERS } from '../../shared/schemas';
import { ApiFailure, api } from '../api';
import { CardStage } from '../lanyards/CardStage';
import { ColourField } from '../lanyards/ColourField';
import { addElement, duplicate, makeElement, makeImage, removeElement, reorder, resizeDesign, updateElement, uploadImage } from '../lanyards/edit';
import { loadFonts } from '../lanyards/fonts';
import type { RenderContext } from '../lanyards/render';
import { ImageCache, SAMPLE_PERSON, designFonts, renderToCanvas } from '../lanyards/render';
import { useDesignEditor } from '../lanyards/useDesign';
import { Button, Icon, IconButton, LoadError, Loading, Notice, PageHeader, Segmented, useConfirm, useToast } from '../ui';
import type { IconName } from '../ui';
import { useEvent } from './EventLayout';
import { LanyardTabs } from './LanyardPrint';

export const PHOTO_MARKER_WORDS: Record<PhotoMarker, string> = {
  black_border: 'Black border',
  colour_border: 'Coloured border',
  red_dot: 'Red circle',
  camera_icon: 'Crossed-out camera',
  none: 'No mark',
};

const TYPE_ICON: Record<DesignElement['type'], IconName> = { text: 'text', shape: 'square', image: 'image', qr: 'qr', marker: 'noPhoto' };

/** Is focus somewhere typing happens (so keyboard shortcuts stay out of the way)? */
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/** People › Lanyards › Design: design the card on the page. */
export function LanyardDesigner() {
  const { event, can, base, reload } = useEvent();
  const toast = useToast();
  const confirm = useConfirm();
  const canConfigure = can('event.configure');
  const editable = canConfigure && (event.status === 'draft' || event.status === 'open');
  const ed = useDesignEditor(event.id, editable);
  const [side, setSide] = useState<SideKey>('front');
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [redraw, setRedraw] = useState(0);
  const [preview, setPreview] = useState<CardPerson>(SAMPLE_PERSON);
  const [noPhotos, setNoPhotos] = useState(false);
  const images = useMemo(() => new ImageCache(event.id), [event.id]);
  const fileInput = useRef<HTMLInputElement>(null);
  const propsPanel = useRef<HTMLElement>(null);
  const uploadAs = useRef<'image' | 'background'>('image');
  const design = ed.design;

  const ctx: RenderContext = useMemo(() => ({ campName: event.name, marker: event.lanyard }), [event.name, event.lanyard]);
  const person = useMemo(() => ({ ...preview, noPhotos }), [preview, noPhotos]);

  // Fonts and images: load what the design uses, then redraw.
  const fontKey = design ? JSON.stringify(designFonts(design)) : '';
  useEffect(() => {
    if (!design) return;
    void loadFonts(designFonts(design)).then(() => setRedraw((n) => n + 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontKey]);
  const imageKey = design ? [...design.front.elements, ...design.back.elements].map((e) => (e.type === 'image' ? e.assetId : '')).join() : '';
  useEffect(() => {
    if (!design) return;
    void images.loadAll(design).then(() => setRedraw((n) => n + 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageKey, images]);
  // A new selection shows its settings from the top.
  useEffect(() => {
    if (propsPanel.current) propsPanel.current.scrollTop = 0;
  }, [selected]);
  // Every font, for the font picker's samples.
  useEffect(() => {
    void loadFonts(FONT_IDS.map((f) => ({ font: f, weight: 400 as FontWeight }))).then(() => setRedraw((n) => n + 1));
  }, []);

  const change = ed.change;
  const set = useCallback((patch: Partial<DesignElement>, live = false) => selected && change((d) => updateElement(d, side, selected, patch), { live }), [change, selected, side]);
  const add = useCallback(
    (el: DesignElement) => {
      change((d) => addElement(d, side, el));
      setSelected(el.id);
    },
    [change, side],
  );

  // Keyboard: delete, nudge, undo/redo, duplicate, deselect.
  useEffect(() => {
    if (!editable || !design) return;
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) ed.redo();
        else ed.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        ed.redo();
        return;
      }
      if (e.key === 'Escape') return setSelected(null);
      const el = design[side].elements.find((x) => x.id === selected);
      if (!el) return;
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const r = duplicate(design, side, el.id);
        change(r.design);
        setSelected(r.id);
        return;
      }
      if (el.locked) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        change((d) => removeElement(d, side, el.id));
        setSelected(null);
        return;
      }
      const step = e.shiftKey ? 5 : 0.5;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const m = moves[e.key];
      if (m) {
        e.preventDefault();
        change((d) => updateElement(d, side, el.id, { x: Math.round((el.x + m[0]) * 10) / 10, y: Math.round((el.y + m[1]) * 10) / 10 }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editable, design, side, selected, change, ed]);

  if (!canConfigure) return <Navigate to={`${base}/people/lanyards/print`} replace />;

  const header = (
    <>
      <PageHeader
        title="Lanyards"
        back={{ to: `${base}/people`, label: 'People' }}
        summary={<SaveStatus state={ed.save.state} message={ed.save.message} onRetry={ed.retrySave} editable={editable} />}
      />
      <LanyardTabs base={base} current="design" />
    </>
  );
  if (ed.loadError && !design)
    return (
      <>
        {header}
        <LoadError error={ed.loadError} onRetry={ed.reload} what="the lanyard design" />
      </>
    );
  if (!design)
    return (
      <>
        {header}
        <Loading what="the lanyard design" />
      </>
    );

  const card = cardSize(design.format, design.orientation);
  const el = design[side].elements.find((e) => e.id === selected) ?? null;
  const warnings = designWarnings(design);

  async function onFile(file: File | undefined) {
    if (!file || !design) return;
    try {
      const { id, bitmap } = await uploadImage(event.id, file);
      images.put(id, bitmap);
      add(makeImage(design, id, bitmap.width, bitmap.height, uploadAs.current === 'background'));
      if (uploadAs.current === 'background') change((d) => reorder(d, side, d[side].elements[d[side].elements.length - 1]!.id, 'back'));
    } catch (err) {
      toast(err instanceof ApiFailure || err instanceof Error ? err.message : 'That image couldn’t be added.', { tone: 'error' });
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  const pick = (as: 'image' | 'background') => {
    uploadAs.current = as;
    fileInput.current?.click();
  };

  return (
    <div className="studio-page">
      {header}
      {!editable && (
        <Notice tone="info">
          <p>{event.status === 'draft' || event.status === 'open' ? 'You can look at the design but not change it.' : 'This camp is closed, so its lanyard design can’t be changed. You can still print.'}</p>
        </Notice>
      )}
      <p className="studio-small-screen only-phone">The designer works best on a computer or tablet. You can preview the card here and print from the Print tab.</p>

      <div className="studio">
        {/* ---------- Left: add things, and layers ---------- */}
        <aside className="studio-panel studio-left" aria-label="Add to the card">
          {editable && (
            <section className="studio-section">
              <h2 className="studio-heading">Add</h2>
              <div className="studio-add-grid">
                <AddButton icon="text" label="Text" onClick={() => add(makeElement(design, 'text'))} />
                <AddButton icon="qr" label="QR code" onClick={() => add(makeElement(design, 'qr'))} />
                <AddButton icon="image" label="Image" onClick={() => pick('image')} />
                <AddButton icon="layers" label="Background" onClick={() => pick('background')} />
                <AddButton icon="square" label="Rectangle" onClick={() => add(makeElement(design, 'rect'))} />
                <AddButton icon="circle" label="Circle" onClick={() => add(makeElement(design, 'ellipse'))} />
                <AddButton icon="band" label="Section band" onClick={() => add(makeElement(design, 'band'))} />
                <AddButton icon="noPhoto" label="No-photo mark" onClick={() => add(makeElement(design, 'marker'))} />
              </div>
              <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="visually-hidden" tabIndex={-1} aria-hidden="true" onChange={(e) => void onFile(e.target.files?.[0])} />
              <h3 className="studio-label">Details that fill in for each person</h3>
              <div className="studio-chips">
                {FIELD_IDS.map((f) => (
                  <button key={f} type="button" className="chip" onClick={() => add(makeElement(design, 'field', f))}>
                    <Icon name="plus" size={16} />
                    {FIELDS[f].label}
                  </button>
                ))}
              </div>
            </section>
          )}
          <section className="studio-section studio-layers">
            <h2 className="studio-heading">Layers</h2>
            {design[side].elements.length === 0 ? (
              <p className="meta">Nothing on the {side} yet.</p>
            ) : (
              <ol className="layer-list" reversed>
                {[...design[side].elements].reverse().map((x) => (
                  <li key={x.id} className={x.id === selected ? 'is-selected' : undefined}>
                    <button type="button" className="layer-name" aria-pressed={x.id === selected} onClick={() => setSelected(x.id)}>
                      <Icon name={TYPE_ICON[x.type]} size={16} />
                      <span>{layerName(x)}</span>
                    </button>
                    {editable && (
                      <IconButton label={x.locked ? `Unlock ${layerName(x)}` : `Lock ${layerName(x)}`} className="layer-lock" onClick={() => change((d) => updateElement(d, side, x.id, { locked: !x.locked }))}>
                        <Icon name={x.locked ? 'lock' : 'unlock'} size={16} />
                      </IconButton>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>

        {/* ---------- Middle: the card ---------- */}
        <section className="studio-centre" aria-label="Card">
          <div className="studio-toolbar">
            <Segmented
              label="Side"
              value={side}
              onChange={(v) => {
                setSide(v);
                setSelected(null);
              }}
              options={[
                { value: 'front', label: 'Front' },
                { value: 'back', label: 'Back' },
              ]}
            />
            <div className="studio-toolbar-group">
              {editable && (
                <>
                  <IconButton label="Undo" disabled={!ed.canUndo} onClick={ed.undo}>
                    <Icon name="undo" />
                  </IconButton>
                  <IconButton label="Redo" disabled={!ed.canRedo} onClick={ed.redo}>
                    <Icon name="redo" />
                  </IconButton>
                </>
              )}
              <IconButton label="Zoom out" disabled={zoom <= 0.5} onClick={() => setZoom((z) => Math.max(0.5, z / 1.25))}>
                <Icon name="zoomOut" />
              </IconButton>
              <button type="button" className="btn btn-ghost btn-small studio-zoom" onClick={() => setZoom(1)} aria-label="Fit the card to the screen">
                {Math.round(zoom * 100)}%
              </button>
              <IconButton label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom((z) => Math.min(3, z * 1.25))}>
                <Icon name="zoomIn" />
              </IconButton>
            </div>
          </div>
          <CardStage
            design={design}
            side={side}
            person={person}
            ctx={ctx}
            images={images}
            redraw={redraw}
            zoom={zoom}
            selected={selected}
            onSelect={setSelected}
            onChange={(d, live) => change(d, { live })}
            onCommit={ed.commit}
            editable={editable}
            label={`The ${side} of the card, as it will print for ${person.name}`}
          />
          <div className="studio-footer">
            <PreviewPicker eventId={event.id} canList={can('roster.view')} value={preview} onChange={setPreview} />
            {event.features.photo && (
              <label className="choice studio-inline-choice">
                <input type="checkbox" checked={noPhotos} onChange={(e) => setNoPhotos(e.target.checked)} />
                <span className="choice-text">Show as someone without photo consent</span>
              </label>
            )}
            <p className="meta studio-hint">
              {CARD_FORMATS[design.format].label}, {design.orientation}. Drag to move, use the corners to resize. Hold Shift to keep the shape, Alt to stop snapping.
            </p>
          </div>
        </section>

        {/* ---------- Right: properties ---------- */}
        <aside ref={propsPanel} className="studio-panel studio-right" aria-label={el ? `${layerName(el)} settings` : 'Card settings'}>
          {el ? (
            <ElementPanel
              key={el.id}
              el={el}
              editable={editable && !el.locked}
              locked={!!el.locked}
              card={card}
              brand={event.brandColor}
              onSet={set}
              onCommit={ed.commit}
              onClose={() => setSelected(null)}
              onAction={(a) => {
                if (a === 'delete') {
                  change((d) => removeElement(d, side, el.id));
                  setSelected(null);
                } else if (a === 'duplicate') {
                  const r = duplicate(design, side, el.id);
                  change(r.design);
                  setSelected(r.id);
                } else if (a === 'unlock') {
                  change((d) => updateElement(d, side, el.id, { locked: false }));
                } else if (a === 'replace') {
                  pick('image');
                } else {
                  change((d) => reorder(d, side, el.id, a));
                }
              }}
            />
          ) : (
            <CardPanel
              design={design}
              side={side}
              editable={editable}
              brand={event.brandColor}
              warnings={warnings}
              onWarning={(w) => {
                if (w.side) setSide(w.side);
                if (w.elementId) setSelected(w.elementId);
              }}
              onChange={(d) => change(d)}
              onReset={async () => {
                const ok = await confirm({ title: 'Start the design again?', body: <p>The card goes back to CampCount’s starting design. You can undo this.</p>, confirm: 'Start again' });
                if (ok) change(starterDesign(design.format, design.orientation));
              }}
              photo={event.features.photo}
              marker={event.lanyard}
              onMarker={async (m) => {
                try {
                  await api(`/events/${event.id}`, { method: 'PATCH', body: { lanyard: m } });
                  await reload();
                } catch (err) {
                  toast(err instanceof ApiFailure ? err.message : 'No connection. Try again.', { tone: 'error' });
                }
              }}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function layerName(el: DesignElement): string {
  if (el.name) return el.name;
  if (el.type === 'text') return el.text.slice(0, 30) || 'Text';
  return { shape: 'Shape', image: 'Image', qr: 'QR code', marker: 'No-photo mark', text: 'Text' }[el.type];
}

function AddButton({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button type="button" className="studio-add" onClick={onClick}>
      <Icon name={icon} size={22} />
      <span>{label}</span>
    </button>
  );
}

function SaveStatus({ state, message, onRetry, editable }: { state: string; message: string | null; onRetry: () => void; editable: boolean }) {
  if (!editable) return <span>Design the front and back of every lanyard.</span>;
  return (
    <span className="save-status" aria-live="polite">
      {state === 'saving' && 'Saving…'}
      {state === 'unsaved' && 'Saving…'}
      {state === 'saved' && (
        <>
          <Icon name="check" size={16} /> Saved
        </>
      )}
      {state === 'error' && (
        <>
          <span className="save-error">{message ?? 'Not saved.'}</span>{' '}
          <button type="button" className="link-button" onClick={onRetry}>
            Try again
          </button>
        </>
      )}
    </span>
  );
}

/** Preview the card with a real person from the camp, or the sample. */
function PreviewPicker({ eventId, canList, value, onChange }: { eventId: string; canList: boolean; value: CardPerson; onChange: (p: CardPerson) => void }) {
  const [people, setPeople] = useState<(CardPerson & { id: string })[] | null>(null);
  useEffect(() => {
    if (!canList) return;
    api<{ registrations: { id: string; displayName?: string; firstName: string; preferredName: string; lastName: string; kind: 'youth' | 'adult'; section: string; groupName: string; shortCode: string | null; status: string; photoConsent?: string }[] }>(`/events/${eventId}/registrations`)
      .then((r) =>
        setPeople(
          r.registrations
            .filter((x) => x.status === 'active')
            .slice(0, 500)
            .map((x) => ({
              id: x.id,
              name: `${x.preferredName || x.firstName} ${x.lastName}`.trim(),
              firstName: x.preferredName || x.firstName,
              lastName: x.lastName,
              kind: x.kind,
              section: x.section,
              groupName: x.groupName,
              shortCode: x.shortCode ?? SAMPLE_PERSON.shortCode,
              qr: SAMPLE_PERSON.qr,
            })),
        ),
      )
      .catch(() => setPeople([]));
  }, [eventId, canList]);
  const current = people?.find((p) => p.name === value.name && p.groupName === value.groupName)?.id ?? '';
  return (
    <div className="studio-preview-pick">
      <label htmlFor="ly-preview" className="studio-label">
        Preview as
      </label>
      <select
        id="ly-preview"
        className="select select-small"
        value={current}
        onChange={(e) => {
          const p = people?.find((x) => x.id === e.target.value);
          onChange(p ?? SAMPLE_PERSON);
        }}
      >
        <option value="">{SAMPLE_PERSON.name} (example)</option>
        {people?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------- panels

function Num({ id, label, value, onChange, step = 0.5, min, max, unit = 'mm', disabled }: { id: string; label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; unit?: string; disabled?: boolean }) {
  return (
    <div className="num-field">
      <label htmlFor={id} className="studio-label">
        {label}
      </label>
      <div className="num-input">
        <input
          id={id}
          key={value}
          className="input input-small"
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          max={max}
          defaultValue={Math.round(value * 10) / 10}
          disabled={disabled}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v !== value) onChange(min !== undefined ? Math.max(min, max !== undefined ? Math.min(max, v) : v) : v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        <span className="num-unit">{unit}</span>
      </div>
    </div>
  );
}

function PanelGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="studio-section">
      {title && <h3 className="studio-subheading">{title}</h3>}
      {children}
    </div>
  );
}

type Action = 'delete' | 'duplicate' | 'forward' | 'backward' | 'front' | 'back' | 'unlock' | 'replace';

function ElementPanel({
  el,
  editable,
  locked,
  card,
  brand,
  onSet,
  onCommit,
  onClose,
  onAction,
}: {
  el: DesignElement;
  editable: boolean;
  locked: boolean;
  card: { w: number; h: number };
  brand: string | null;
  onSet: (patch: Partial<DesignElement>, live?: boolean) => void;
  onCommit: () => void;
  onClose: () => void;
  onAction: (a: Action) => void;
}) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const insert = (f: FieldId) => {
    if (el.type !== 'text') return;
    const ta = textRef.current;
    const token = `{${f}}`;
    const at = ta ? ta.selectionStart : el.text.length;
    const end = ta ? ta.selectionEnd : el.text.length;
    onSet({ text: el.text.slice(0, at) + token + el.text.slice(end) } as Partial<TextElement>);
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(at + token.length, at + token.length);
    });
  };
  const centre = (axis: 'x' | 'y') => onSet(axis === 'x' ? { x: Math.round(((card.w - el.w) / 2) * 10) / 10 } : { y: Math.round(((card.h - el.h) / 2) * 10) / 10 });

  return (
    <div className="studio-props">
      <div className="studio-props-head">
        <h2 className="studio-heading">{layerName(el)}</h2>
        <IconButton label="Done" onClick={onClose}>
          <Icon name="close" />
        </IconButton>
      </div>
      {locked && (
        <Notice tone="info">
          <p>This is locked so it can’t be moved by accident.</p>
          <Button small onClick={() => onAction('unlock')}>
            <Icon name="unlock" size={16} /> Unlock
          </Button>
        </Notice>
      )}

      {el.type === 'text' && (
        <>
          <PanelGroup>
            <label htmlFor="prop-text" className="studio-label">
              Words
            </label>
            <textarea id="prop-text" ref={textRef} className="textarea" rows={2} value={el.text} disabled={!editable} onChange={(e) => onSet({ text: e.target.value } as Partial<TextElement>)} maxLength={400} />
            <p className="meta">Add a detail that fills in for each person:</p>
            <div className="studio-chips">
              {FIELD_IDS.map((f) => (
                <button key={f} type="button" className="chip chip-small" disabled={!editable} onClick={() => insert(f)}>
                  {FIELDS[f].label}
                </button>
              ))}
            </div>
          </PanelGroup>
          <PanelGroup title="Font">
            <div className="font-list" role="radiogroup" aria-label="Font">
              {FONT_IDS.map((f) => (
                <label key={f} className="font-option" data-font={f}>
                  <input type="radio" name="font" checked={el.font === f} disabled={!editable} onChange={() => onSet({ font: f, weight: fontWeight(f, el.weight) } as Partial<TextElement>)} />
                  <span>{FONTS[f].label}</span>
                </label>
              ))}
            </div>
            <div className="studio-row">
              <Num id="prop-size" label="Size" unit="pt" step={0.5} min={4} max={120} value={el.size} disabled={!editable} onChange={(v) => onSet({ size: v } as Partial<TextElement>)} />
              <WeightPicker font={el.font} value={el.weight} disabled={!editable} onChange={(w) => onSet({ weight: w } as Partial<TextElement>)} />
            </div>
            <input
              type="range"
              className="range"
              aria-label="Text size"
              min={4}
              max={72}
              step={0.5}
              value={Math.min(72, el.size)}
              disabled={!editable}
              onChange={(e) => onSet({ size: Number(e.target.value) } as Partial<TextElement>, true)}
              onPointerUp={onCommit}
              onKeyUp={onCommit}
            />
            <div className="studio-row">
              <div className="icon-toggle-group" role="radiogroup" aria-label="Alignment">
                {(['left', 'center', 'right'] as const).map((a) => (
                  <button key={a} type="button" role="radio" aria-checked={el.align === a} className="icon-toggle" disabled={!editable} onClick={() => onSet({ align: a } as Partial<TextElement>)}>
                    <Icon name={a === 'left' ? 'alignLeft' : a === 'center' ? 'alignCenter' : 'alignRight'} />
                    <span className="visually-hidden">Align {a === 'center' ? 'centre' : a}</span>
                  </button>
                ))}
              </div>
              <button type="button" className="icon-toggle text-toggle" aria-pressed={!!el.uppercase} disabled={!editable} onClick={() => onSet({ uppercase: !el.uppercase } as Partial<TextElement>)}>
                AA<span className="visually-hidden"> Capital letters</span>
              </button>
            </div>
            <label className="choice">
              <input type="checkbox" checked={el.wrap} disabled={!editable} onChange={(e) => onSet({ wrap: e.target.checked } as Partial<TextElement>)} />
              <span className="choice-text">
                Wrap onto more lines
                <span className="meta">Otherwise long words shrink to fit on one line.</span>
              </span>
            </label>
          </PanelGroup>
          <PanelGroup>
            <ColourField label="Colour" value={el.colour} section="text" extra={brand} onChange={(v) => editable && onSet({ colour: v } as Partial<TextElement>)} />
          </PanelGroup>
        </>
      )}

      {el.type === 'shape' && (
        <>
          <PanelGroup>
            <Segmented
              label="Shape"
              value={el.shape}
              onChange={(v) => editable && onSet({ shape: v } as Partial<ShapeElement>)}
              options={[
                { value: 'rect', label: 'Rectangle' },
                { value: 'ellipse', label: 'Circle' },
              ]}
            />
          </PanelGroup>
          <PanelGroup>
            <ColourField label="Fill" value={el.fill} allowNone section="fill" extra={brand} onChange={(v) => editable && onSet({ fill: v } as Partial<ShapeElement>)} />
          </PanelGroup>
          <PanelGroup title="Border">
            <ColourField label="Border colour" value={el.stroke} allowNone section="fill" extra={brand} onChange={(v) => editable && onSet({ stroke: v, strokeWidth: v !== 'none' && el.strokeWidth === 0 ? 0.5 : el.strokeWidth } as Partial<ShapeElement>)} />
            <div className="studio-row">
              <Num id="prop-stroke" label="Border width" value={el.strokeWidth} min={0} max={10} step={0.25} disabled={!editable} onChange={(v) => onSet({ strokeWidth: v } as Partial<ShapeElement>)} />
              {el.shape === 'rect' && <Num id="prop-radius" label="Corners" value={el.radius} min={0} max={60} step={0.5} disabled={!editable} onChange={(v) => onSet({ radius: v } as Partial<ShapeElement>)} />}
            </div>
          </PanelGroup>
          <PanelGroup>
            <Opacity value={el.opacity} disabled={!editable} onChange={(v, live) => onSet({ opacity: v } as Partial<ShapeElement>, live)} onCommit={onCommit} />
          </PanelGroup>
        </>
      )}

      {el.type === 'image' && (
        <>
          <PanelGroup>
            <Segmented
              label="Fit"
              value={el.fit}
              onChange={(v) => editable && onSet({ fit: v } as Partial<ImageElement>)}
              options={[
                { value: 'contain', label: 'Show all' },
                { value: 'cover', label: 'Fill the box' },
              ]}
            />
            <p className="meta">{el.fit === 'cover' ? 'Fills the box, trimming the edges if the shapes differ.' : 'Shows the whole image inside the box.'}</p>
          </PanelGroup>
          <PanelGroup>
            <div className="studio-row">
              <Num id="prop-radius" label="Corners" value={el.radius} min={0} max={60} step={0.5} disabled={!editable} onChange={(v) => onSet({ radius: v } as Partial<ImageElement>)} />
            </div>
            <Opacity value={el.opacity} disabled={!editable} onChange={(v, live) => onSet({ opacity: v } as Partial<ImageElement>, live)} onCommit={onCommit} />
            {editable && (
              <Button small onClick={() => onAction('replace')}>
                <Icon name="image" size={16} /> Add another image
              </Button>
            )}
          </PanelGroup>
        </>
      )}

      {el.type === 'qr' && (
        <PanelGroup>
          <p className="meta">Each person’s own QR code goes here. It always prints black on white, so every phone can scan it. Keep it at least 15 mm wide.</p>
        </PanelGroup>
      )}
      {el.type === 'marker' && (
        <PanelGroup>
          <p className="meta">For people without photo consent, the mark you choose under Card settings appears here. Everyone else’s card shows nothing in this spot.</p>
        </PanelGroup>
      )}

      <PanelGroup title="Position and size">
        <div className="studio-grid-2">
          <Num id="prop-x" label="Left" value={el.x} disabled={!editable} onChange={(v) => onSet({ x: v })} />
          <Num id="prop-y" label="Top" value={el.y} disabled={!editable} onChange={(v) => onSet({ y: v })} />
          <Num id="prop-w" label="Width" value={el.w} min={1} disabled={!editable} onChange={(v) => onSet(el.type === 'qr' || el.type === 'marker' ? { w: v, h: v } : { w: v })} />
          <Num id="prop-h" label="Height" value={el.h} min={1} disabled={!editable} onChange={(v) => onSet(el.type === 'qr' || el.type === 'marker' ? { w: v, h: v } : { h: v })} />
        </div>
        {editable && (
          <div className="studio-row">
            <Button small kind="ghost" onClick={() => centre('x')}>
              Centre across
            </Button>
            <Button small kind="ghost" onClick={() => centre('y')}>
              Centre down
            </Button>
          </div>
        )}
      </PanelGroup>

      {editable && (
        <PanelGroup title="Arrange">
          <div className="studio-row studio-arrange">
            <IconButton label="Bring forward" onClick={() => onAction('forward')}>
              <Icon name="forward" />
            </IconButton>
            <IconButton label="Send backward" onClick={() => onAction('backward')}>
              <Icon name="backward" />
            </IconButton>
            <IconButton label="Duplicate" onClick={() => onAction('duplicate')}>
              <Icon name="copy" />
            </IconButton>
            <IconButton label="Delete" className="icon-btn-danger" onClick={() => onAction('delete')}>
              <Icon name="trash" />
            </IconButton>
          </div>
        </PanelGroup>
      )}
    </div>
  );
}

function WeightPicker({ font, value, onChange, disabled }: { font: FontId; value: FontWeight; onChange: (w: FontWeight) => void; disabled?: boolean }) {
  const weights = FONTS[font].weights as readonly FontWeight[];
  const names: Record<number, string> = { 400: 'Regular', 700: 'Bold', 800: 'Extra bold' };
  return (
    <div className="num-field">
      <label htmlFor="prop-weight" className="studio-label">
        Weight
      </label>
      <select id="prop-weight" className="select select-small" value={fontWeight(font, value)} disabled={disabled || weights.length < 2} onChange={(e) => onChange(Number(e.target.value) as FontWeight)}>
        {weights.map((w) => (
          <option key={w} value={w}>
            {names[w]}
          </option>
        ))}
      </select>
    </div>
  );
}

function Opacity({ value, onChange, onCommit, disabled }: { value: number; onChange: (v: number, live: boolean) => void; onCommit: () => void; disabled?: boolean }) {
  return (
    <div className="num-field">
      <label htmlFor="prop-opacity" className="studio-label">
        See-through <span className="meta">{Math.round((1 - value) * 100)}%</span>
      </label>
      <input
        id="prop-opacity"
        type="range"
        className="range"
        min={0}
        max={0.9}
        step={0.05}
        value={1 - value}
        disabled={disabled}
        onChange={(e) => onChange(Math.round((1 - Number(e.target.value)) * 100) / 100, true)}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
    </div>
  );
}

function CardPanel({
  design,
  side,
  editable,
  brand,
  warnings,
  onWarning,
  onChange,
  onReset,
  photo,
  marker,
  onMarker,
}: {
  design: LanyardDesign;
  side: SideKey;
  editable: boolean;
  brand: string | null;
  warnings: ReturnType<typeof designWarnings>;
  onWarning: (w: ReturnType<typeof designWarnings>[number]) => void;
  onChange: (d: LanyardDesign) => void;
  onReset: () => void;
  photo: boolean;
  marker: { photoMarker: PhotoMarker; photoMarkerColour: string; photoMarkerLabel: boolean; printBand: boolean };
  onMarker: (m: Partial<{ photoMarker: PhotoMarker; photoMarkerColour: string; photoMarkerLabel: boolean }>) => Promise<void>;
}) {
  const setFormat = (format: CardFormat, orientation: Orientation) => onChange(resizeDesign(design, format, format === 'large' ? 'portrait' : orientation));
  return (
    <div className="studio-props">
      <h2 className="studio-heading">Card settings</h2>
      <PanelGroup title="Ready to print?">
        {warnings.length === 0 ? (
          <p className="studio-ok">
            <Icon name="success" size={18} /> Looks good. Every card has a name, a QR code and a typed code.
          </p>
        ) : (
          <ul className="studio-warnings">
            {warnings.map((w, i) => (
              <li key={i} className={w.level === 'error' ? 'is-error' : undefined}>
                <Icon name={w.level === 'error' ? 'error' : 'warning'} size={18} />
                {w.elementId ? (
                  <button type="button" className="link-button" onClick={() => onWarning(w)}>
                    {w.message}
                  </button>
                ) : (
                  <span>{w.message}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </PanelGroup>
      <PanelGroup title="Size">
        <fieldset className="size-options" disabled={!editable}>
          <legend className="visually-hidden">Card size</legend>
          {CARD_FORMAT_KEYS.map((f) => (
            <label key={f} className="size-option">
              <input type="radio" name="card-format" checked={design.format === f} onChange={() => setFormat(f, design.orientation)} />
              <span className={`size-glyph size-glyph-${f}`} aria-hidden="true" />
              <span className="choice-text">
                {CARD_FORMATS[f].label}
                <span className="meta">{CARD_FORMATS[f].detail}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {design.format === 'cr80' && (
          <Segmented
            label="Orientation"
            value={design.orientation}
            onChange={(o) => editable && setFormat(design.format, o)}
            options={[
              { value: 'portrait', label: 'Portrait' },
              { value: 'landscape', label: 'Landscape' },
            ]}
          />
        )}
        <p className="meta">Changing size stretches what’s on the card to fit. Undo if you don’t like it.</p>
      </PanelGroup>
      <PanelGroup>
        <ColourField
          label={`Background (${side})`}
          value={design[side].background}
          extra={brand}
          onChange={(v) => editable && v.startsWith('#') && onChange({ ...design, [side]: { ...design[side], background: v } })}
        />
      </PanelGroup>
      {photo && (
        <PanelGroup title="No photo consent">
          <label htmlFor="marker" className="studio-label">
            How their card is marked
          </label>
          <select id="marker" className="select select-small" value={marker.photoMarker} disabled={!editable} onChange={(e) => void onMarker({ photoMarker: e.target.value as PhotoMarker })}>
            {PHOTO_MARKERS.map((m) => (
              <option key={m} value={m}>
                {PHOTO_MARKER_WORDS[m]}
              </option>
            ))}
          </select>
          <p className="meta">
            {marker.photoMarker === 'black_border' || marker.photoMarker === 'colour_border'
              ? 'A thick frame around the edge of both sides.'
              : marker.photoMarker === 'none'
                ? 'Nothing extra. Photographers check the list instead.'
                : 'Shown where you put the No-photo mark.'}
          </p>
          {marker.photoMarker === 'colour_border' && (
            <ColourField label="Border colour" value={marker.photoMarkerColour} onChange={(v) => editable && v.startsWith('#') && void onMarker({ photoMarkerColour: v })} />
          )}
          {(marker.photoMarker === 'black_border' || marker.photoMarker === 'colour_border' || marker.photoMarker === 'none') && (
            <label className="choice">
              <input type="checkbox" checked={marker.photoMarkerLabel} disabled={!editable} onChange={(e) => void onMarker({ photoMarkerLabel: e.target.checked })} />
              <span className="choice-text">Also print “No photos” where the No-photo mark is</span>
            </label>
          )}
        </PanelGroup>
      )}
      {editable && (
        <PanelGroup>
          <Button small kind="ghost" onClick={onReset}>
            Start the design again
          </Button>
        </PanelGroup>
      )}
    </div>
  );
}

/** A small, non-interactive rendering of one side (used on phones and in Print). */
export function CardThumb({ design, side, person, ctx, images, redraw, width }: { design: LanyardDesign; side: SideKey; person: CardPerson; ctx: RenderContext; images: ImageCache; redraw: number; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { w, h } = cardSize(design.format, design.orientation);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    renderToCanvas(c, design, side, person, ctx, images, (width / w) * Math.min(2, window.devicePixelRatio || 1));
  }, [design, side, person, ctx, images, redraw, width, w]);
  return <canvas ref={ref} className="card-thumb" style={{ width, height: (width * h) / w }} aria-hidden="true" />;
}
