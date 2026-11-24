import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import type { LevelSetting } from '../../shared/levels';
import { textOn } from '../../shared/levels';
import { ApiFailure, api } from '../api';
import { useApi } from '../useApi';
import { Badge, Banner, Button, Icon, PageHeader, Toggle, plural, useToast } from '../ui';
import { SaveBar } from '../ui/EventSaveBar';
import { useEvent } from './EventLayout';

type Row = LevelSetting & { from?: string; id: string };

/**
 * Settings › Levels: what each level is called at this camp, the word and
 * colour on its lanyards, and whether it counts as youth. Renaming moves
 * everyone in the level with it; a level can be removed once it's empty.
 */
export function LevelsSettings() {
  const { event, can, reload, base } = useEvent();
  const navigate = useNavigate();
  const toast = useToast();
  const roster = useApi<{ registrations: { level: string; status: string }[] }>(can('roster.view') ? `/events/${event.id}/registrations` : null);
  const [initial] = useState<Row[]>(() => event.levels.map((s, i) => ({ ...s, from: s.name, id: `s${i}` })));
  const [rows, setRows] = useState<Row[]>(initial);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const back = { to: `${base}/settings`, label: 'Settings' };
  const editable = event.status === 'draft' || event.status === 'open';
  if (!can('event.configure')) return <Navigate to={back.to} replace />;

  const counts = new Map<string, number>();
  for (const r of roster.data?.registrations ?? []) counts.set(r.level, (counts.get(r.level) ?? 0) + 1);
  const set = (id: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);

  async function save(e: FormEvent) {
    e.preventDefault();
    setFailure(null);
    const names = rows.map((r) => r.name.trim().toLowerCase());
    if (names.some((n) => !n)) return setFailure('Give each level a name.');
    if (new Set(names).size !== names.length) return setFailure('Two levels have the same name.');
    setBusy(true);
    try {
      await api(`/events/${event.id}`, {
        method: 'PATCH',
        body: {
          levels: rows.map((r) => ({
            ...(r.from ? { from: r.from } : {}),
            name: r.name.trim(),
            word: r.word.trim(),
            colour: r.colour,
            youth: r.youth,
            ...(r.aliases?.length ? { aliases: r.aliases } : {}),
          })),
        },
      });
      await reload();
      toast('Levels saved');
      navigate(back.to);
    } catch (err) {
      setFailure(err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  const addLevel = (
    <Button
      small
      onClick={() => setRows((rs) => [...rs, { id: `new${Date.now()}`, name: '', word: '', colour: '#5A6770', youth: true }])}
      disabled={!editable || busy}
    >
      <Icon name="plus" /> Add a level
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Levels"
        back={back}
        summary={`${plural(rows.length, 'level')} · ${plural(rows.filter((r) => r.youth).length, 'youth level')}`}
        help={
          <>
            Renaming a level moves everyone in it. Youth levels count as youth everywhere: reports, bookings and the Side Quest; everyone else is an adult. Names linked on the import screen are listed under each level. A level that appears
            in an import is added here automatically.
          </>
        }
      />
      <form className="settings-form" onSubmit={save} noValidate>
        {(!editable || failure) && (
          <div className="banners">
            {!editable && <Banner>Locked while the event isn’t open.</Banner>}
            {failure && <Banner tone="error">{failure}</Banner>}
          </div>
        )}
        <fieldset className="sec-fieldset" disabled={!editable || busy}>
          <div className="sec-table" role="table" aria-label="Levels">
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
              const label = r.name || 'this level';
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
                      checked={r.youth}
                      onChange={(on) => set(r.id, { youth: on })}
                      label={<span className="sec-toggle-label">Youth</span>}
                    />
                  </span>
                  <span role="cell" className="sec-side">
                    <span className="meta">
                      {!r.from ? <Badge tone="info">New</Badge> : roster.data ? <span className="sec-count">{plural(n, 'person', 'people')}</span> : ''}
                    </span>
                    {rows.length > 1 && (
                      <Button small kind="ghost" disabled={n > 0} aria-label={`Remove ${label}`} title={n > 0 ? 'People are in this level' : undefined} onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}>
                        {n > 0 ? 'In use' : <Icon name="trash" size={18} />}
                      </Button>
                    )}
                  </span>
                  {(r.aliases?.length ?? 0) > 0 && (
                    <div className="sec-links">
                      <span className="meta">Also imported as:</span>
                      {r.aliases!.map((a) => (
                        <span key={a} className="sec-link">
                          {a}
                          <button
                            type="button"
                            className="sec-link-remove"
                            aria-label={`Stop linking ${a} to ${label}`}
                            onClick={() => set(r.id, { aliases: r.aliases!.filter((x) => x !== a) })}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {editable && <div className="sec-add">{addLevel}</div>}
        </fieldset>
        {editable && <SaveBar dirty={dirty} busy={busy} saveLabel="Save levels" onCancel={() => navigate(back.to)} />}
      </form>
    </>
  );
}
