import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import type { SectionSetting } from '../../shared/sections';
import { textOn } from '../../shared/sections';
import { ApiFailure, api } from '../api';
import { useApi } from '../useApi';
import { Badge, Banner, Button, Icon, PageHeader, Toggle, plural, useToast } from '../ui';
import { SaveBar } from '../ui/EventSaveBar';
import { useEvent } from './EventLayout';

type Row = SectionSetting & { from?: string; id: string };

const BUILT_IN_NOTE: Record<string, string> = {
  Leaders: 'Built-in · adults',
  Other: 'Built-in · no section',
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
  const [initial] = useState<Row[]>(() => event.sections.map((s, i) => ({ ...s, from: s.name, id: `s${i}` })));
  const [rows, setRows] = useState<Row[]>(initial);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const back = { to: `${base}/settings`, label: 'Settings' };
  const editable = event.status === 'draft' || event.status === 'open';
  if (!can('event.configure')) return <Navigate to={back.to} replace />;

  const counts = new Map<string, number>();
  for (const r of roster.data?.registrations ?? []) counts.set(r.section, (counts.get(r.section) ?? 0) + 1);
  const set = (id: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);

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

  const addSection = (
    <Button
      small
      onClick={() => setRows((rs) => [...rs, { id: `new${Date.now()}`, name: '', base: 'custom', word: '', colour: '#5A6770', youth: true }])}
      disabled={!editable || busy}
    >
      <Icon name="plus" /> Add a section
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Sections"
        back={back}
        summary={`${plural(rows.length, 'section')} · ${plural(rows.filter((r) => r.base !== 'Leaders' && r.youth).length, 'youth section')}`}
        help={
          <>
            Renaming a section moves everyone in it. Youth sections count as youth everywhere: reports, bookings and the Side Quest; everyone else is an adult. Imports file people
            under the built-in sections, so a renamed one keeps working. Put someone in an added section from their People page or in Import &amp; check.
          </>
        }
        primary={editable && addSection}
      />
      <form className="settings-form" onSubmit={save} noValidate>
        {(!editable || failure) && (
          <div className="banners">
            {!editable && <Banner>Locked while the event isn’t open.</Banner>}
            {failure && <Banner tone="error">{failure}</Banner>}
          </div>
        )}
        <fieldset className="sec-fieldset" disabled={!editable || busy}>
          <div className="sec-table" role="table" aria-label="Sections">
            <div className="sec-row sec-head" role="row">
              <span role="columnheader">Lanyard</span>
              <span role="columnheader">Name</span>
              <span role="columnheader">Word on lanyards</span>
              <span role="columnheader">Colour</span>
              <span role="columnheader">Youth</span>
              <span role="columnheader">
                <span className="visually-hidden">Type and actions</span>
              </span>
            </div>
            {rows.map((r) => {
              const n = counts.get(r.from ?? '') ?? 0;
              const fg = textOn(r.colour);
              const label = r.name || 'this section';
              return (
                <div key={r.id} className="sec-row" role="row">
                  <span role="cell">
                    <span className="section-swatch" style={{ background: r.colour, color: fg }} aria-hidden="true">
                      {r.word || '—'}
                    </span>
                  </span>
                  <div role="cell" className="sec-cell">
                    <span className="sec-label">Name</span>
                    <input className="input" value={r.name} maxLength={40} onChange={(e) => set(r.id, { name: e.target.value })} aria-label={`Name of ${label}`} />
                  </div>
                  <div role="cell" className="sec-cell">
                    <span className="sec-label">Word on lanyards</span>
                    <input className="input" value={r.word} maxLength={20} placeholder="No word" onChange={(e) => set(r.id, { word: e.target.value })} aria-label={`Lanyard word for ${label}`} />
                  </div>
                  <div role="cell" className="sec-cell sec-colour">
                    <span className="sec-label">Colour</span>
                    <input type="color" value={r.colour} onChange={(e) => set(r.id, { colour: e.target.value.toUpperCase() })} aria-label={`Colour for ${label}`} />
                    <span className="meta num">{r.colour}</span>
                  </div>
                  <span role="cell" className="sec-cell">
                    <Toggle
                      checked={r.base !== 'Leaders' && r.youth}
                      disabled={r.base === 'Leaders'}
                      onChange={(on) => set(r.id, { youth: on })}
                      label={<span className="sec-toggle-label">Youth</span>}
                    />
                  </span>
                  <span role="cell" className="sec-side">
                    <span className="meta">
                      {r.base === 'custom' ? <Badge tone="info">Added</Badge> : <span title={`Built-in: ${r.base}`}>{BUILT_IN_NOTE[r.base] ?? 'Built-in'}</span>}
                      {r.from && roster.data ? <span className="sec-count"> · {plural(n, 'person', 'people')}</span> : ''}
                    </span>
                    {r.base === 'custom' && (
                      <Button small kind="ghost" disabled={n > 0} aria-label={`Remove ${label}`} title={n > 0 ? 'People are in this section' : undefined} onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}>
                        {n > 0 ? 'In use' : <Icon name="trash" size={18} />}
                      </Button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </fieldset>
        {editable && <SaveBar dirty={dirty} busy={busy} saveLabel="Save sections" onCancel={() => navigate(back.to)} />}
      </form>
    </>
  );
}
