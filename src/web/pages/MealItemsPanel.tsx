import { useState } from 'react';
import type { DragEvent, FormEvent } from 'react';
import type { MealCategory, MealItem, MealItemInput } from '../../shared/mealItems';
import { ALLERGENS, DIETARY_TAGS, MEAL_CATEGORIES } from '../../shared/mealItems';
import { ApiFailure, api } from '../api';
import type { Meal } from '../model';
import { Badge, Button, Choice, Field, Icon, Menu, Notice, Sheet, Toggle, useConfirm, useToast } from '../ui';

const fail = (err: unknown) => (err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.');

/** Items grouped by category, in category order, keeping each item's own order. */
export function byCategory(items: MealItem[]): [MealCategory, MealItem[]][] {
  return MEAL_CATEGORIES.map((c) => [c, items.filter((i) => i.category === c).sort((a, b) => a.sortOrder - b.sortOrder)] as [MealCategory, MealItem[]]).filter(([, l]) => l.length > 0);
}

/** Allergen and dietary chips: contains solid, may contain outlined. */
export function ItemChips({ item }: { item: Pick<MealItem, 'contains' | 'mayContain' | 'dietary' | 'status'> }) {
  if (!item.contains.length && !item.mayContain.length && !item.dietary.length && item.status !== 'tbc') return null;
  return (
    <span className="mi-chips">
      {item.status === 'tbc' && <Badge tone="warning">TBC</Badge>}
      {item.contains.map((a) => (
        <span key={`c-${a}`} className="mi-chip is-contains" title={`Contains ${a}`}>
          {a}
        </span>
      ))}
      {item.mayContain.map((a) => (
        <span key={`m-${a}`} className="mi-chip is-may" title={`May contain ${a}`}>
          may: {a}
        </span>
      ))}
      {item.dietary.map((t) => (
        <span key={`d-${t}`} className="mi-chip is-diet">
          {t}
        </span>
      ))}
    </span>
  );
}

/**
 * One meal's items, as on the Meals page when its card is open: what's
 * served to everyone and the dietary alternatives, each grouped by category
 * (collapsible), with add, edit, duplicate, delete and drag to reorder.
 */
export function MealItemsPanel({
  eventId,
  meal,
  items,
  meals,
  allItems,
  manage,
  onChanged,
}: {
  eventId: string;
  meal: Meal;
  items: MealItem[];
  meals: Meal[];
  allItems: MealItem[];
  manage: boolean;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<MealItem | 'new' | null>(null);
  const [copying, setCopying] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const names = new Map(items.map((i) => [i.id, i.name]));
  const custom = (key: 'contains' | 'dietary') => [...new Set(allItems.flatMap((i) => (key === 'contains' ? [...i.contains, ...i.mayContain] : [...i.dietary, ...i.alternativeFor])))];

  const act = async (work: () => Promise<unknown>, done: string) => {
    try {
      await work();
      toast(done);
      await onChanged();
    } catch (err) {
      toast(fail(err), { tone: 'error' });
    }
  };

  const reorder = (list: MealItem[], fromId: string, toId: string) => {
    const ids = list.map((i) => i.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]!);
    void act(() => api(`/events/${eventId}/meals/${meal.id}/items/reorder`, { body: { ids } }), 'Order saved');
  };

  const section = (title: string, list: MealItem[], empty: string) => (
    <section className="mi-section">
      <h4>
        {title} <span className="meta num">{list.length}</span>
      </h4>
      {list.length === 0 ? (
        <p className="meta">{empty}</p>
      ) : (
        byCategory(list).map(([cat, catItems]) => (
          // Big meals start closed (each category shows its count); small ones open.
          <details key={cat} className="mi-cat" open={items.length <= 12}>
            <summary>
              <Icon name="chevron" size={16} />
              {cat} <span className="meta num">{catItems.length}</span>
            </summary>
            <ul className="mi-list">
              {catItems.map((it, idx) => {
                const isOpen = open === it.id;
                return (
                  // Drag to reorder with a mouse; "Move up" and "Move down" in the item's menu do the same from the keyboard.
                  // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
                  <li
                    key={it.id}
                    className={['mi-row', drag === it.id && 'is-dragging'].filter(Boolean).join(' ')}
                    draggable={manage}
                    onDragStart={(e: DragEvent) => {
                      setDrag(it.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => setDrag(null)}
                    onDragOver={(e) => drag && catItems.some((x) => x.id === drag) && e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (drag) reorder(catItems, drag, it.id);
                      setDrag(null);
                    }}
                  >
                    <div className="mi-head">
                      {manage && (
                        <span className="mi-grip" aria-hidden="true" title="Drag to reorder">
                          ⋮⋮
                        </span>
                      )}
                      <button type="button" className="mi-name" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : it.id)}>
                        <Icon name="chevron" size={14} />
                        <span>{it.name}</span>
                      </button>
                      <ItemChips item={it} />
                      {manage && (
                        <Menu
                          label={`More for ${it.name}`}
                          items={[
                            { label: 'Edit item', onSelect: () => setEditing(it) },
                            { label: 'Duplicate', onSelect: () => void act(() => api(`/events/${eventId}/meal-items/${it.id}/duplicate`, { body: {} }), `${it.name} duplicated`) },
                            idx > 0 && { label: 'Move up', onSelect: () => reorder(catItems, it.id, catItems[idx - 1]!.id) },
                            idx < catItems.length - 1 && { label: 'Move down', onSelect: () => reorder(catItems, it.id, catItems[idx + 1]!.id) },
                            {
                              label: 'Delete item…',
                              danger: true,
                              onSelect: async () => {
                                if (!(await confirm({ title: `Delete ${it.name}?`, body: <p>It comes off {meal.name}.</p>, confirm: 'Delete', danger: true }))) return;
                                await act(() => api(`/events/${eventId}/meal-items/${it.id}`, { method: 'DELETE' }), `${it.name} deleted`);
                              },
                            },
                          ]}
                        />
                      )}
                    </div>
                    {it.isAlternative && (
                      <p className="mi-alt">
                        {[it.replacesItemId && names.get(it.replacesItemId) ? `Replaces: ${names.get(it.replacesItemId)}` : null, it.alternativeFor.length ? `For: ${it.alternativeFor.join(', ')}` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                    {isOpen && (
                      <div className="mi-detail">
                        {it.ingredients ? <p className="mi-ingredients">{it.ingredients}</p> : <p className="meta">No ingredients listed.</p>}
                        {it.internalNotes && (
                          <p className="mi-notes">
                            <strong>Staff notes:</strong> {it.internalNotes}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </details>
        ))
      )}
    </section>
  );

  const main = items.filter((i) => !i.isAlternative);
  const alts = items.filter((i) => i.isAlternative);
  return (
    <div className="mi-panel">
      {manage && (
        <div className="btn-row mi-actions">
          <Button small kind="primary" onClick={() => setEditing('new')}>
            <Icon name="plus" /> Add item
          </Button>
          <Button small onClick={() => setCopying(true)}>
            <Icon name="copy" /> Copy from another meal
          </Button>
        </div>
      )}
      <div className="pg-mi-columns">
        {section('Served to everyone', main, manage ? 'Nothing yet. Add items, or copy them from another meal.' : 'Nothing listed yet.')}
        {section('Dietary alternatives', alts, 'No alternatives.')}
      </div>
      {meal.ingredients && (
        <section className="mi-section">
          <h4>Additional notes</h4>
          <p className="mi-ingredients">{meal.ingredients}</p>
        </section>
      )}

      <Sheet open={editing !== null} title={editing === 'new' ? `Add item to ${meal.name}` : 'Edit item'} onClose={() => setEditing(null)}>
        {editing !== null && (
          <ItemForm
            item={editing === 'new' ? undefined : editing}
            mealItems={items}
            customAllergens={custom('contains')}
            customTags={custom('dietary')}
            onCancel={() => setEditing(null)}
            onSave={async (body) => {
              if (editing === 'new') await api(`/events/${eventId}/meals/${meal.id}/items`, { body });
              else await api(`/events/${eventId}/meal-items/${editing.id}`, { method: 'PATCH', body });
              setEditing(null);
              toast(editing === 'new' ? `${body.name} added` : 'Item saved');
              await onChanged();
            }}
          />
        )}
      </Sheet>
      <Sheet open={copying} title={`Copy items into ${meal.name}`} onClose={() => setCopying(false)}>
        {copying && (
          <CopyItems
            meals={meals.filter((m) => m.id !== meal.id)}
            allItems={allItems}
            onCancel={() => setCopying(false)}
            onCopy={async (fromMealId, itemIds) => {
              const res = await api<{ copied: number }>(`/events/${eventId}/meals/${meal.id}/items/copy`, { body: { fromMealId, itemIds } });
              setCopying(false);
              toast(`Copied ${res.copied} ${res.copied === 1 ? 'item' : 'items'}`);
              await onChanged();
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

/** Toggle chips for known labels, plus custom ones. */
function LabelPicker({ id, label, value, options, onChange, hint }: { id: string; label: string; value: string[]; options: string[]; onChange: (v: string[]) => void; hint?: string }) {
  const [extra, setExtra] = useState('');
  const all = [...new Set([...options, ...value])];
  const add = () => {
    const t = extra.trim().toLowerCase();
    if (t && !value.includes(t)) onChange([...value, t]);
    setExtra('');
  };
  return (
    <fieldset className="mi-picker">
      <legend className="field-label">{label}</legend>
      {hint && <p className="meta">{hint}</p>}
      <div className="mi-picker-chips" role="group" aria-label={label}>
        {all.map((o) => (
          <button key={o} type="button" className="mi-pick" aria-pressed={value.includes(o)} onClick={() => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o])}>
            {o}
          </button>
        ))}
      </div>
      <div className="mi-picker-add">
        <input
          id={id}
          className="input"
          placeholder="Add another"
          value={extra}
          maxLength={40}
          onChange={(e) => setExtra(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          aria-label={`Add another: ${label}`}
        />
        <Button small onClick={add} disabled={!extra.trim()}>
          Add
        </Button>
      </div>
    </fieldset>
  );
}

function ItemForm({
  item,
  mealItems,
  customAllergens,
  customTags,
  onSave,
  onCancel,
}: {
  item?: MealItem;
  mealItems: MealItem[];
  customAllergens: string[];
  customTags: string[];
  onSave: (body: MealItemInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [f, setF] = useState<MealItemInput>({
    name: item?.name ?? '',
    category: item?.category ?? 'Main',
    ingredients: item?.ingredients ?? '',
    contains: item?.contains ?? [],
    mayContain: item?.mayContain ?? [],
    dietary: item?.dietary ?? [],
    isAlternative: item?.isAlternative ?? false,
    replacesItemId: item?.replacesItemId ?? null,
    alternativeFor: item?.alternativeFor ?? [],
    status: item?.status ?? 'confirmed',
    internalNotes: item?.internalNotes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = <K extends keyof MealItemInput>(k: K, v: MealItemInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const allergens = [...new Set([...ALLERGENS, ...customAllergens])];
  const tags = [...new Set([...DIETARY_TAGS, ...customTags.filter((t) => !(ALLERGENS as readonly string[]).includes(t))])];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) return setProblem('Give the item a name.');
    setBusy(true);
    setProblem(null);
    try {
      await onSave({ ...f, name: f.name.trim(), replacesItemId: f.isAlternative ? f.replacesItemId : null, alternativeFor: f.isAlternative ? f.alternativeFor : [] });
    } catch (err) {
      setProblem(fail(err));
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      {problem && (
        <Notice tone="error">
          <p>{problem}</p>
        </Notice>
      )}
      <Field id="mi-name" label="Name" hint="Like Drakes white bread rolls 6pk">
        <input className="input" value={f.name} maxLength={200} onChange={(e) => set('name', e.target.value)} autoComplete="off" />
      </Field>
      <div className="field-pair">
        <Field id="mi-cat" label="Category">
          <select className="select" value={f.category} onChange={(e) => set('category', e.target.value as MealCategory)}>
            {MEAL_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field id="mi-status" label="Ingredients">
          <select className="select" value={f.status} onChange={(e) => set('status', e.target.value as MealItemInput['status'])}>
            <option value="confirmed">Confirmed</option>
            <option value="tbc">To be confirmed (TBC)</option>
          </select>
        </Field>
      </div>
      <Field id="mi-ingredients" label="Ingredients list" optional hint="As on the pack.">
        <textarea className="textarea" rows={5} maxLength={5000} value={f.ingredients} onChange={(e) => set('ingredients', e.target.value)} />
      </Field>
      <LabelPicker id="mi-contains" label="Contains" value={f.contains} options={allergens} onChange={(v) => set('contains', v)} />
      <LabelPicker id="mi-may" label="May contain" value={f.mayContain} options={allergens} onChange={(v) => set('mayContain', v)} />
      <LabelPicker id="mi-dietary" label="Suitable for" value={f.dietary} options={tags} onChange={(v) => set('dietary', v)} />
      <Toggle label="Dietary alternative" hint="A substitute for the people who need it, not served to everyone." checked={f.isAlternative} onChange={(v) => set('isAlternative', v)} />
      {f.isAlternative && (
        <>
          <Field id="mi-replaces" label="Replaces" optional>
            <select className="select" value={f.replacesItemId ?? ''} onChange={(e) => set('replacesItemId', e.target.value || null)}>
              <option value="">Nothing in particular</option>
              {mealItems
                .filter((i) => !i.isAlternative && i.id !== item?.id)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
            </select>
          </Field>
          <LabelPicker
            id="mi-for"
            label="Who it’s for"
            hint="Like gluten free, sesame"
            value={f.alternativeFor}
            options={[...tags, ...allergens]}
            onChange={(v) => set('alternativeFor', v)}
          />
        </>
      )}
      <Field id="mi-notes" label="Staff notes" optional hint="Never shown to participants.">
        <textarea className="textarea" rows={2} maxLength={2000} value={f.internalNotes} onChange={(e) => set('internalNotes', e.target.value)} />
      </Field>
      <div className="btn-row">
        <Button type="submit" kind="primary" busy={busy} busyLabel="Saving…">
          {item ? 'Save item' : 'Add item'}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function CopyItems({ meals, allItems, onCopy, onCancel }: { meals: Meal[]; allItems: MealItem[]; onCopy: (fromMealId: string, itemIds?: string[]) => Promise<void>; onCancel: () => void }) {
  const withItems = meals.filter((m) => allItems.some((i) => i.mealId === m.id));
  const [from, setFrom] = useState(withItems[0]?.id ?? '');
  const items = allItems.filter((i) => i.mealId === from);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const chosen = picked ?? new Set(items.map((i) => i.id));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (withItems.length === 0) return <p className="meta">No other meal has items yet.</p>;
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setProblem(null);
        try {
          await onCopy(from, chosen.size === items.length ? undefined : [...chosen]);
        } catch (err) {
          setProblem(fail(err));
          setBusy(false);
        }
      }}
    >
      {problem && (
        <Notice tone="error">
          <p>{problem}</p>
        </Notice>
      )}
      <Field id="copy-from" label="Copy from">
        <select
          className="select"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPicked(null);
          }}
        >
          {withItems.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({allItems.filter((i) => i.mealId === m.id).length} items)
            </option>
          ))}
        </select>
      </Field>
      <fieldset className="choices mi-copy-list">
        <legend className="field-label">
          Items ({chosen.size} of {items.length})
        </legend>
        <div className="btn-row">
          <Button small kind="ghost" onClick={() => setPicked(new Set(items.map((i) => i.id)))}>
            All
          </Button>
          <Button small kind="ghost" onClick={() => setPicked(new Set())}>
            None
          </Button>
        </div>
        {items.map((i) => (
          <Choice
            key={i.id}
            label={i.name}
            description={[i.category, i.isAlternative ? 'alternative' : null].filter(Boolean).join(' · ')}
            checked={chosen.has(i.id)}
            onChange={(e) => {
              const next = new Set(chosen);
              if (e.target.checked) next.add(i.id);
              else next.delete(i.id);
              setPicked(next);
            }}
          />
        ))}
      </fieldset>
      <div className="btn-row">
        <Button type="submit" kind="primary" busy={busy} busyLabel="Copying…" disabled={chosen.size === 0}>
          Copy {chosen.size} {chosen.size === 1 ? 'item' : 'items'}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
