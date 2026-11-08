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
  myTeam: { id: string; name: string; members: string[] } | null;
  teams: { id: string; name: string; size: number; full: boolean }[];
}

const sizeText = (te: ParticipantTeamEvent) =>
  te.maxSize !== null ? (te.maxSize === te.minSize ? `Teams of ${te.minSize}` : `Teams of ${te.minSize} to ${te.maxSize}`) : te.minSize > 1 ? `Teams of ${te.minSize} or more` : null;

/** For participants: each team event, their own team, and the teams they can join or make. */
export function TeamsPanel({
  teamEvents,
  tz,
  busy,
  onCreate,
  onJoin,
  onLeave,
}: {
  teamEvents: ParticipantTeamEvent[];
  tz: string;
  busy: boolean;
  onCreate: (activityId: string, name: string) => void;
  onJoin: (teamId: string, name: string) => void;
  onLeave: (teamId: string) => void;
}) {
  const [names, setNames] = useState<Record<string, string>>({});
  if (teamEvents.length === 0) return <p className="meta">No team events yet.</p>;
  return (
    <div className="sections">
      {teamEvents.map((te) => {
        const when = te.startsAt ? `${dayLabel(dayInZone(te.startsAt, tz))}, ${timeRange(te.startsAt, te.endsAt, tz)}` : null;
        const joinable = te.teams.filter((t) => !t.full && t.id !== te.myTeam?.id);
        const name = names[te.id] ?? '';
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
                {te.open && (
                  <div>
                    <Button small kind="ghost" disabled={busy} onClick={() => onLeave(te.myTeam!.id)}>
                      Leave team
                    </Button>
                  </div>
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
                          <Button small disabled={busy} onClick={() => onJoin(t.id, t.name)}>
                            Join
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="meta">{te.teams.length ? 'Every team is full.' : 'No teams yet. Make the first one.'}</p>
                )}
                {te.canMakeTeam && (
                  <form
                    className="team-new"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (name.trim()) onCreate(te.id, name.trim());
                    }}
                  >
                    <Field id={`new-team-${te.id}`} label="Or make a new team">
                      <input className="input" maxLength={40} placeholder="Team name" value={name} onChange={(e) => setNames({ ...names, [te.id]: e.target.value })} autoComplete="off" />
                    </Field>
                    <Button type="submit" kind="primary" disabled={busy || !name.trim()}>
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
