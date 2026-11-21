import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import type { SectionSetting } from '../../shared/sections';
import { textOn } from '../../shared/sections';
import { ApiFailure, api } from '../api';
import { useApi } from '../useApi';
import { Button, Icon, Notice, PageHeader, plural, useToast } from '../ui';
import { useEvent } from './EventLayout';

type Row = SectionSetting & { from?: string; id: string };

const BUILT_IN_NOTE: Record<string, string> = {
  Leaders: 'Built-in: Leaders, always adults',
  Other: 'Built-in: anyone without a section',
};

/**
 * Settings › Sections: what each section is called at this camp, the word
 * and colour on its lanyards, whether it counts as youth, and sections of
 * the camp's own. The built-in ones can be renamed but not removed (imports
 * map onto them); renaming moves everyone in the section with it.
 */
export function SectionsSettings() {
  const { event, can, reload, base } = useEvent();
  const navigate = useNavigate();
  const toast = useToast();
  const roster = useApi<{ registrations: { section: string; status: string }[] }>(can('roster.view') ? `/events/${event.id}/registrations` : null);
  const [rows, setRows] = useState<Row[]>(() => event.sections.map((s, i) => ({ ...s, from: s.name, id: `s${i}` })));
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const back = { to: `${base}/settings`, label: 'Settings' };
  const editable = event.status === 'draft' || event.status === 'open';
  if (!can('event.configure')) return <Navigate to={back.to} replace />;

  const counts = new Map<string, number>();
  for (const r of roster.data?.registrations ?? []) counts.set(r.section, (counts.get(r.section) ?? 0) + 1);
  const set = (id: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  async function save(e: FormEvent) {
    e.preventDefault();
    setFailure(null);
    const names = rows.map((r) => r.name.trim().toLowerCase());
    if (names.some((n) => !n)) return setFailure('Give each section a name.');
    if (new Set(names).size !== names.length) return setFailure('Two sections have the same name.');
    setBusy(true);
    try {
      await api(`/events/${event.id}`, {
        method: 'PATCH',
        body: {
          sections: rows.map((r) => ({
            ...(r.from ? { from: r.from } : {}),
            name: r.name.trim(),
            base: r.base,
            word: r.word.trim(),
            colour: r.colour,
            youth: r.base === 'Leaders' ? false : r.youth,
          })),
        },
      });
      await reload();
      toast('Sections saved');
      navigate(back.to);
    } catch (err) {
      setFailure(err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Sections"
        back={back}
        summary="Rename sections, set the word and colour on their lanyards, choose which count as youth, and add your own. Renaming a section moves everyone in it."
      />
      <form className="form sections-form" onSubmit={save} noValidate>
        {failure && (
          <Notice tone="error">
            <p>{failure}</p>
          </Notice>
        )}
        <fieldset className="form" disabled={!editable || busy}>
          <ul className="list section-settings">
            {rows.map((r) => {
              const n = counts.get(r.from ?? '') ?? 0;
              const fg = textOn(r.colour);
              return (
                <li key={r.id} className="row section-setting">
                  <span className="section-swatch" style={{ background: r.colour, color: fg }} aria-hidden="true">
                    {r.word || '—'}
                  </span>
                  <div className="section-setting-fields">
                    <label className="section-field">
                      <span className="meta">Name</span>
                      <input className="input" value={r.name} maxLength={40} onChange={(e) => set(r.id, { name: e.target.value })} />
                    </label>
                    <label className="section-field">
                      <span className="meta">On lanyards</span>
                      <input className="input" value={r.word} maxLength={20} placeholder="No word" onChange={(e) => set(r.id, { word: e.target.value })} />
                    </label>
                    <label className="section-field section-colour">
                      <span className="meta">Colour</span>
                      <input type="color" value={r.colour} onChange={(e) => set(r.id, { colour: e.target.value.toUpperCase() })} aria-label={`Colour for ${r.name || 'this section'}`} />
                    </label>
                    <label className="section-field section-youth">
                      <input type="checkbox" checked={r.base !== 'Leaders' && r.youth} disabled={r.base === 'Leaders'} onChange={(e) => set(r.id, { youth: e.target.checked })} />
                      <span>Youth</span>
                    </label>
                  </div>
                  <span className="section-setting-side">
                    <span className="meta">
                      {r.base === 'custom' ? 'Added' : (BUILT_IN_NOTE[r.base] ?? `Built-in: ${r.base}`)}
                      {r.from && roster.data ? ` · ${plural(n, 'person', 'people')}` : ''}
                    </span>
                    {r.base === 'custom' && (
                      <Button
                        small
                        kind="ghost"
                        disabled={n > 0}
                        aria-label={`Remove ${r.name || 'this section'}`}
                        onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                      >
                        {n > 0 ? 'In use' : 'Remove'}
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          <div>
            <Button
              kind="ghost"
              onClick={() => setRows((rs) => [...rs, { id: `new${Date.now()}`, name: '', base: 'custom', word: '', colour: '#5A6770', youth: true }])}
            >
              <Icon name="plus" /> Add a section
            </Button>
          </div>
        </fieldset>
        <p className="meta">
          Youth sections count as youth everywhere: reports, bookings and the Side Quest. Everyone else is an adult. Imports file people under the built-in sections, so a
          renamed one keeps working. Choose an added section for someone on their People page or in Import & check.
        </p>
        {editable && (
          <div className="btn-row">
            <Button type="submit" kind="primary" busy={busy} busyLabel="Saving…">
              Save sections
            </Button>
            <Button onClick={() => navigate(back.to)}>Cancel</Button>
          </div>
        )}
      </form>
    </>
  );
}
