import { useState } from 'react';
import { dayInZone, dayLabel, timeRange } from '../../shared/time';
import { Badge, Button, Field } from '../ui';

export interface ParticipantTeamEvent {
  id: string;
  name: string;
  location: string;
  startsAt: string | null;
  endsAt: string | null;
  minSize: number;
  maxSize: number | null;
  open: boolean;
  canMakeTeam: boolean;
  /** Your team. Its code (locked teams) is only shown to people on it. */
  myTeam: { id: string; name: string; locked?: boolean; joinCode?: string | null; members: string[] } | null;
  teams: { id: string; name: string; locked?: boolean; size: number; full: boolean }[];
}

export interface TeamActions {
  onCreate: (activityId: string, name: string, locked: boolean, friends: string[]) => void;
  onJoin: (teamId: string, name: string) => void;
  onJoinCode: (activityId: string, code: string) => void;
  onAddFriend: (teamId: string, memberNumber: string) => void;
  onLeave: (teamId: string) => void;
}

const sizeText = (te: ParticipantTeamEvent) =>
  te.maxSize !== null ? (te.maxSize === te.minSize ? `Teams of ${te.minSize}` : `Teams of ${te.minSize} to ${te.maxSize}`) : te.minSize > 1 ? `Teams of ${te.minSize} or more` : null;

/** Membership numbers typed in one box, separated by spaces, commas or new lines. */
const numbers = (text: string) =>
  text
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 10);

/**
 * For participants: each team event, their own team, and the teams they can
 * join or make. A team can be open (anyone joins) or locked (join with its
 * code, or be added by someone on it). Friends are added by the membership
 * number on their lanyard.
 */
export function TeamsPanel({ teamEvents, tz, busy, notice, ...act }: { teamEvents: ParticipantTeamEvent[]; tz: string; busy: boolean; notice?: string | null } & TeamActions) {
  const [forms, setForms] = useState<Record<string, { name: string; locked: boolean; friends: string; code: string; add: string }>>({});
  if (teamEvents.length === 0) return <p className="meta">No team events yet.</p>;
  const formOf = (id: string) => forms[id] ?? { name: '', locked: false, friends: '', code: '', add: '' };
  const setForm = (id: string, patch: Partial<ReturnType<typeof formOf>>) => setForms((f) => ({ ...f, [id]: { ...formOf(id), ...patch } }));

  return (
    <div className="sections">
      {notice && <p className="team-notice">{notice}</p>}
      {teamEvents.map((te) => {
        const when = te.startsAt ? `${dayLabel(dayInZone(te.startsAt, tz))}, ${timeRange(te.startsAt, te.endsAt, tz)}` : null;
        const joinable = te.teams.filter((t) => !t.full && t.id !== te.myTeam?.id);
        const f = formOf(te.id);
        return (
          <section key={te.id} className="signup-section team-pick" aria-labelledby={`te-${te.id}`}>
            <div className="section-head">
              <h2 id={`te-${te.id}`}>{te.name}</h2>
              {!te.open && <Badge>Closed</Badge>}
            </div>
            <p className="meta">{[when, te.location, sizeText(te)].filter(Boolean).join(' · ')}</p>
            {te.myTeam ? (
              <div className="team-mine">
                <p>
                  You're on <strong>{te.myTeam.name}</strong>
                  {te.myTeam.members.length < te.minSize ? `. It needs ${te.minSize - te.myTeam.members.length} more.` : '.'}
                </p>
                <p className="meta">{te.myTeam.members.join(', ')}</p>
                {te.myTeam.locked && te.myTeam.joinCode && (
                  <p className="team-code">
                    Locked team. Friends join with the code <strong className="num">{te.myTeam.joinCode}</strong>
                  </p>
                )}
                {te.open && (
                  <>
                    <form
                      className="team-add"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (f.add.trim()) act.onAddFriend(te.myTeam!.id, f.add.trim());
                        setForm(te.id, { add: '' });
                      }}
                    >
                      <Field id={`team-add-${te.id}`} label="Add a friend" hint="The membership number on their lanyard.">
                        <input className="input" inputMode="numeric" maxLength={24} value={f.add} onChange={(e) => setForm(te.id, { add: e.target.value })} autoComplete="off" />
                      </Field>
                      <Button type="submit" small disabled={busy || !f.add.trim()}>
                        Add
                      </Button>
                    </form>
                    <div>
                      <Button small kind="ghost" disabled={busy} onClick={() => act.onLeave(te.myTeam!.id)}>
                        Leave team
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ) : !te.open ? (
              <p>Teams are closed. Ask a leader if you need to change.</p>
            ) : (
              <>
                {joinable.length > 0 ? (
                  <ul className="list">
                    {joinable.map((t) => (
                      <li key={t.id} className="row">
                        <span className="row-main">
                          <span className="row-title">{t.name}</span>
                          <span className="row-meta">
                            {t.size} {t.size === 1 ? 'person' : 'people'}
                            {te.maxSize !== null ? `, room for ${te.maxSize - t.size} more` : ''}
                          </span>
                        </span>
                        <span className="row-side">
                          {t.locked ? (
                            <Badge>Locked</Badge>
                          ) : (
                            <Button small disabled={busy} onClick={() => act.onJoin(t.id, t.name)}>
                              Join
                            </Button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="meta">{te.teams.length ? 'Every team is full.' : 'No teams yet. Make the first one.'}</p>
                )}
                {te.teams.some((t) => t.locked && !t.full) && (
                  <form
                    className="team-add"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (f.code.trim()) act.onJoinCode(te.id, f.code.trim());
                    }}
                  >
                    <Field id={`team-code-${te.id}`} label="Have a team code?" hint="For a locked team. Ask a friend on it.">
                      <input className="input team-code-input" maxLength={12} value={f.code} onChange={(e) => setForm(te.id, { code: e.target.value.toUpperCase() })} autoComplete="off" />
                    </Field>
                    <Button type="submit" small disabled={busy || !f.code.trim()}>
                      Join
                    </Button>
                  </form>
                )}
                {te.canMakeTeam && (
                  <form
                    className="team-new"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (f.name.trim()) act.onCreate(te.id, f.name.trim(), f.locked, numbers(f.friends));
                    }}
                  >
                    <Field id={`new-team-${te.id}`} label="Or make a new team">
                      <input className="input" maxLength={40} placeholder="Team name" value={f.name} onChange={(e) => setForm(te.id, { name: e.target.value })} autoComplete="off" />
                    </Field>
                    <fieldset className="team-lock">
                      <legend className="field-label">Who can join?</legend>
                      <label className="choice">
                        <input type="radio" name={`lock-${te.id}`} checked={!f.locked} onChange={() => setForm(te.id, { locked: false })} />
                        <span className="choice-text">Anyone</span>
                      </label>
                      <label className="choice">
                        <input type="radio" name={`lock-${te.id}`} checked={f.locked} onChange={() => setForm(te.id, { locked: true })} />
                        <span className="choice-text">
                          Locked
                          <span className="meta">Only people with your team’s code, or friends you add.</span>
                        </span>
                      </label>
                    </fieldset>
                    <Field id={`new-friends-${te.id}`} label="Add friends" optional hint="Their membership numbers, from their lanyards. Separate them with spaces.">
                      <input className="input" inputMode="numeric" value={f.friends} onChange={(e) => setForm(te.id, { friends: e.target.value })} autoComplete="off" />
                    </Field>
                    <Button type="submit" kind="primary" disabled={busy || !f.name.trim()}>
                      Make team
                    </Button>
                  </form>
                )}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
