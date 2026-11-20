import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { SECTION_COLOURS } from '../../shared/lanyardDesign';
import { dayInZone, dayLabel, timeInZone, todayInZone } from '../../shared/time';
import { api } from '../api';
import type { CollectResult, ProgrammeItem, SideQuestStanding, SignupSession, SignupView } from '../components/SignupPanel';
import { TeamsPanel } from '../components/TeamsPanel';
import { loadFont } from '../lanyards/fonts';
import { useTitle } from '../shell';
import { Icon, formatDateRange } from '../ui';
import type { IconName } from '../ui/Icon';
import { SignupStatus, usePerson } from './Signup';

/**
 * A camper's own page: the QR on their lanyard, opened on a phone. It's the
 * one screen most people at camp ever see, so it has its own, brighter look
 * ("Super Splash"): a small pass at the top, then one tab at a time
 * (My day, Book, Teams, Food, and the Side Quest once found).
 *
 * If the camp plays the Side Quest and this phone already belongs to someone
 * else, opening a card collects that person instead (see CollectScreen).
 */
export function Participant() {
  useTitle('My camp');
  const [token] = useState(() => window.location.hash.slice(1));
  const [state, setState] = useState<'loading' | 'page' | 'collect' | 'nocard' | 'inactive'>('loading');
  const [collected, setCollected] = useState<CollectResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const person = usePerson(setError);
  const { setView } = person;
  const ready = useFirstPaintReady(person.view);

  // Display faces for the pass and the big numbers.
  useEffect(() => {
    void loadFont('bebas-neue', 400);
    void loadFont('permanent-marker', 400);
  }, []);

  const showMine = useCallback(async () => {
    setState('loading');
    try {
      setView(await api<SignupView>('/public/signup/me', { body: {} }));
      // The friend's card link isn't theirs: leave a clean address they can come back to.
      window.history.replaceState(null, '', '/c');
      setState('page');
    } catch {
      setState('nocard');
    }
  }, [setView]);

  const open = useCallback(
    async (claim = false) => {
      setState('loading');
      try {
        const res = await identifyOnce(token, claim);
        if ('collect' in res) {
          setCollected(res.collect);
          setState('collect');
        } else {
          setView(res);
          setState('page');
        }
      } catch {
        setState('inactive');
      }
    },
    [token, setView],
  );

  useEffect(() => {
    if (/^[A-Za-z0-9_-]{22}$/.test(token)) void open();
    else void showMine();
  }, [token, open, showMine]);

  if (state === 'collect' && collected) return <CollectScreen result={collected} onDone={() => void showMine()} onMine={() => void open(true)} />;
  if (state === 'inactive' || state === 'nocard')
    return (
      <Shell>
        <div className="pp-empty">
          <h1>{state === 'inactive' ? 'This card isn’t working' : 'Scan your lanyard'}</h1>
          <p>{state === 'inactive' ? 'It may have been replaced with a new one. Ask a leader for help.' : 'Point your phone’s camera at the QR code on your own lanyard to open your camp page.'}</p>
        </div>
      </Shell>
    );
  if (state === 'loading' || !person.view || !ready)
    // A plain page while loading: no placeholder in the wrong colour, and the
    // pass appears once, in the person's own colour with the banner in place.
    return (
      <Shell>
        <p className="visually-hidden" role="status" aria-busy="true">
          Loading your camp page
        </p>
      </Shell>
    );
  return (
    <Shell>
      <Page view={person.view} busy={person.busy} actions={person} />
      {/* Only problems are shown; a booking shows itself on its own button. */}
      <SignupStatus error={error} done={null} />
    </Shell>
  );
}

/**
 * Hold the page back until the camp's banner and the display fonts are in
 * (at most 2.5 seconds), so it appears once, complete, instead of shifting
 * as the image and fonts arrive. Only the first time: later refreshes show
 * straight away.
 */
function useFirstPaintReady(view: SignupView | null): boolean {
  const [ready, setReady] = useState(false);
  const banner = view?.event.banner?.url ?? null;
  const hasView = view !== null;
  useEffect(() => {
    if (!hasView || ready) return;
    let live = true;
    const image = banner
      ? new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => void img.decode().then(resolve, resolve);
          img.onerror = () => resolve();
          img.src = banner;
        })
      : Promise.resolve();
    const fonts = document.fonts?.ready ?? Promise.resolve();
    void Promise.race([Promise.all([image, fonts]), new Promise((r) => setTimeout(r, 2500))]).then(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, [hasView, banner, ready]);
  return ready;
}

/**
 * Opening a card is done once per page load, even if the page starts twice:
 * a second request would turn "You collected Mia!" into "Already collected".
 */
const opening = new Map<string, Promise<SignupView | { collect: CollectResult }>>();
function identifyOnce(token: string, claim: boolean) {
  const k = `${token}:${claim}`;
  let p = opening.get(k);
  if (!p) {
    p = api<SignupView | { collect: CollectResult }>('/public/signup/identify', { body: claim ? { token, claim: true } : { token } });
    opening.set(k, p);
    // Forget it shortly after, so opening the same card again later asks the server again.
    void p.finally(() => setTimeout(() => opening.delete(k), 2000));
  }
  return p;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="pp">
      <main id="main" className="pp-main">
        {children}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- helpers

const startOf = (it: { startsAt: string | null }) => (it.startsAt ? Date.parse(it.startsAt) : NaN);
const endOf = (it: { startsAt: string | null; endsAt: string | null }) => (it.endsAt ? Date.parse(it.endsAt) : startOf(it) + 60 * 60_000);
const key = (it: { name: string; startsAt: string | null }) => `${it.name}|${it.startsAt ?? ''}`;

function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

// ---------------------------------------------------------------- the page

type Actions = ReturnType<typeof usePerson>;
type Tab = 'roster' | 'day' | 'book' | 'teams' | 'food' | 'quest';

/**
 * One tab at a time, picked from the bar at the bottom, so nothing is a
 * long scroll. Buttons change in place (Book → Booked) rather than popping
 * anything up, so the screen never jumps.
 */
function Page({ view, busy, actions }: { view: SignupView; busy: boolean; actions: Actions }) {
  const tz = view.event.timezone;
  const now = useNow();
  const programme = view.programme ?? [];
  const mine = useMemo(() => new Set(view.bookings.map((b) => key(b))), [view.bookings]);
  const meals = programme.filter((i) => i.kind === 'meal');
  const teamEvents = view.teamEvents ?? [];
  // Leaders don't book activities, so they don't get the Book tab.
  const isAdult = view.person.sectionWord === 'Adult';
  const canBook = !isAdult && (view.sessions.length > 0 || view.bookings.length > 0);
  const quest = view.sideQuest && view.sideQuest.collected > 0 ? view.sideQuest : null;

  const duties = view.duties ?? [];
  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    // Leaders on the roster see their duties first.
    ...(duties.length ? [{ id: 'roster' as const, label: 'Roster', icon: 'clipboard' as const }] : []),
    { id: 'day', label: 'My day', icon: 'events' },
    ...(canBook ? [{ id: 'book' as const, label: 'Book', icon: 'ticket' as const }] : []),
    ...(teamEvents.length ? [{ id: 'teams' as const, label: 'Teams', icon: 'team' as const }] : []),
    ...(meals.length ? [{ id: 'food' as const, label: 'Food', icon: 'meal' as const }] : []),
    ...(quest ? [{ id: 'quest' as const, label: 'Quest', icon: 'star' as const }] : []),
  ];
  const [tab, setTabState] = useState<Tab>(() => {
    const saved = sessionStorage.getItem('cc-pp-tab') as Tab | null;
    return saved ?? (duties.length ? 'roster' : 'day');
  });
  const current = tabs.some((t) => t.id === tab) ? tab : (tabs[0]?.id ?? 'day');
  const setTab = (t: Tab) => {
    setTabState(t);
    sessionStorage.setItem('cc-pp-tab', t);
    window.scrollTo({ top: 0 });
  };

  return (
    <>
      <Pass view={view} />
      <div className="pp-panel">
        {current === 'roster' && <Roster duties={duties} now={now} tz={tz} />}
        {current === 'day' && <MyDay items={programme} mine={mine} now={now} tz={tz} />}
        {current === 'book' && <Book view={view} busy={busy} onBook={actions.book} onCancel={actions.cancel} />}
        {current === 'teams' && (
          <section className="pp-section" aria-labelledby="teams-h">
            <h2 id="teams-h">Teams</h2>
            <div className="pp-teams">
              <TeamsPanel
                teamEvents={teamEvents}
                tz={tz}
                busy={busy}
                onCreate={(id, name) => actions.createTeam(id, name)}
                onJoin={(id, name) => actions.joinTeam(id, name)}
                onLeave={(id) => actions.leaveTeam(id)}
              />
            </div>
          </section>
        )}
        {current === 'food' && <Food meals={meals} tz={tz} />}
        {current === 'quest' && quest && <QuestCard quest={quest} />}
      </div>
      {tabs.length > 1 && (
        <nav className="pp-tabbar" aria-label="My camp">
          {tabs.map((t) => (
            <button key={t.id} type="button" aria-current={current === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
              <Icon name={t.icon} size={22} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      )}
    </>
  );
}

/** Who you are, at which camp. Coloured like your section's lanyard band. */
function Pass({ view }: { view: SignupView }) {
  const word = view.person.sectionWord ?? 'Scout';
  const colour = SECTION_COLOURS[word]?.bg ?? '#00843D';
  const first = view.person.firstName ?? view.person.name.split(' ')[0];
  const last = view.person.lastName ?? '';
  const banner = view.event.banner;
  return (
    <header className="pp-pass" style={{ ['--pass' as string]: colour }}>
      {banner ? (
        // The camp's own graphic stands in for its name.
        <img className="pp-banner" src={banner.url} width={banner.width} height={banner.height} alt={view.event.name} />
      ) : (
        <p className="pp-pass-camp">
          <strong>{view.event.name}</strong>
          <span>{formatDateRange(view.event.startsOn, view.event.endsOn)}</span>
        </p>
      )}
      <h1 className="pp-name">
        {first}
        {last && <span className="pp-surname">{last}</span>}
      </h1>
      <span className="pp-section-pill">{word}</span>
    </header>
  );
}

/**
 * A leader's roster: where they need to be, when, and doing what. The next
 * (or current) duty is big at the top; the rest follow by day.
 */
function Roster({ duties, now, tz }: { duties: NonNullable<SignupView['duties']>; now: number; tz: string }) {
  const today = todayInZone(tz);
  const upcoming = duties.filter((d) => endOf(d) > now);
  const next = upcoming[0];
  const days = [...new Set(duties.map((d) => dayInZone(d.startsAt, tz)))];
  const where = (d: (typeof duties)[number]) => [d.location, d.with ? `With ${d.with}` : null].filter(Boolean).join(' · ');
  return (
    <section className="pp-section" aria-labelledby="roster-h">
      <h2 id="roster-h">My roster</h2>
      {next ? (
        <div className="pp-duty-next">
          <p className="pp-duty-label">{startOf(next) <= now ? 'On now' : 'Next'}</p>
          <p className="pp-duty-when pp-num">
            {dayInZone(next.startsAt, tz) === today ? 'Today' : dayLabel(dayInZone(next.startsAt, tz), 'long')}, {timeInZone(next.startsAt, tz)}
            {next.endsAt ? ` to ${timeInZone(next.endsAt, tz)}` : ''}
          </p>
          <p className="pp-duty-title">{next.title}</p>
          {next.location && <p className="pp-duty-where">{next.location}</p>}
          {next.notes && <p className="pp-duty-notes">{next.notes}</p>}
        </div>
      ) : (
        <p className="pp-muted">You’ve done all your duties. Thank you!</p>
      )}
      {days.map((d) => (
        <div key={d} className="pp-food-day">
          <h3 className="pp-subhead">{d === today ? 'Today' : dayLabel(d, 'long')}</h3>
          <ol className="pp-timeline">
            {duties
              .filter((x) => dayInZone(x.startsAt, tz) === d)
              .map((x, i) => (
                <li key={i} className={['pp-tl', endOf(x) < now && 'is-past', x === next && 'is-mine'].filter(Boolean).join(' ')}>
                  <span className="pp-tl-time pp-num">{timeInZone(x.startsAt, tz)}</span>
                  <span className="pp-tl-main">
                    <strong>{x.title}</strong>
                    <span>{[x.endsAt ? `until ${timeInZone(x.endsAt, tz)}` : null, where(x)].filter(Boolean).join(' · ')}</span>
                    {x.notes && x !== next && <span>{x.notes}</span>}
                  </span>
                </li>
              ))}
          </ol>
        </div>
      ))}
    </section>
  );
}

/** The day's programme, one day at a time. Your bookings say "Booked". */
function MyDay({ items, mine, now, tz }: { items: ProgrammeItem[]; mine: Set<string>; now: number; tz: string }) {
  const timed = items.filter((i) => i.startsAt).sort((a, b) => startOf(a) - startOf(b));
  const days = [...new Set(timed.map((i) => dayInZone(i.startsAt!, tz)))];
  const today = todayInZone(tz);
  const [day, setDay] = useState(() => (days.includes(today) ? today : (days.find((d) => d > today) ?? days[0] ?? today)));
  const list = timed.filter((i) => dayInZone(i.startsAt!, tz) === day);
  return (
    <section className="pp-section" aria-labelledby="my-day-h">
      <h2 id="my-day-h">My day</h2>
      {days.length > 1 && <DayChips days={days} value={day} today={today} onChange={setDay} />}
      {timed.length === 0 ? (
        <p className="pp-muted">The programme hasn’t been added yet.</p>
      ) : (
        <ol className="pp-timeline">
          {list.map((it, i) => {
            const isMine = mine.has(key(it));
            return (
              <li key={i} className={['pp-tl', endOf(it) < now && 'is-past', isMine && 'is-mine'].filter(Boolean).join(' ')}>
                <span className="pp-tl-time pp-num">{timeInZone(it.startsAt!, tz)}</span>
                <span className="pp-tl-main">
                  <strong>{it.name}</strong>
                  {it.location && <span>{it.location}</span>}
                </span>
                {isMine && (
                  <span className="pp-tag pp-tag-booked">
                    <Icon name="check" size={16} /> Booked
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function DayChips({ days, value, today, onChange, labels }: { days: string[]; value: string; today: string; onChange: (d: string) => void; labels?: Record<string, string> }) {
  return (
    <div className="pp-days" role="group" aria-label="Day">
      {days.map((d) => (
        <button key={d} type="button" aria-pressed={d === value} onClick={() => onChange(d)}>
          {labels?.[d] ?? (d === today ? 'Today' : dayLabel(d))}
        </button>
      ))}
    </div>
  );
}

/**
 * Every activity for the day in a fixed order. Each one is either Booked or
 * has a Book button; booking or cancelling changes that row and nothing else.
 */
function Book({ view, busy, onBook, onCancel }: { view: SignupView; busy: boolean; onBook: (s: SignupSession) => void; onCancel: (id: string) => void }) {
  const tz = view.event.timezone;
  const [pressed, setPressed] = useState<string | null>(null);
  const bookings = new Map(view.bookings.map((b) => [b.activityId, b]));
  // Bookings a leader made for something not on the sign-up list still show, as Booked.
  const rows: (SignupSession & { extra?: boolean })[] = [
    ...view.sessions,
    ...view.bookings
      .filter((b) => !view.sessions.some((s) => s.id === b.activityId))
      .map((b) => ({ id: b.activityId, name: b.name, startsAt: b.startsAt, endsAt: b.endsAt, location: b.location, capacity: null, booked: 0, full: false, extra: true }) as SignupSession & { extra: boolean }),
  ];
  const dayOf = (s: { startsAt: string | null }) => (s.startsAt ? dayInZone(s.startsAt, tz) : 'any');
  const days = [...new Set(rows.map(dayOf))].sort((a, b) => (a === 'any' ? 1 : b === 'any' ? -1 : a.localeCompare(b)));
  const today = todayInZone(tz);
  const [day, setDay] = useState(() => (days.includes(today) ? today : (days.find((d) => d !== 'any' && d > today) ?? days[0] ?? 'any')));
  const clashWith = (s: SignupSession) => {
    if (!s.startsAt) return null;
    const a0 = startOf(s);
    const a1 = endOf(s);
    return view.bookings.find((b) => b.activityId !== s.id && b.startsAt && startOf(b) < a1 && endOf(b) > a0) ?? null;
  };
  const list = rows.filter((s) => dayOf(s) === day).sort((a, b) => (a.startsAt ?? '9').localeCompare(b.startsAt ?? '9') || a.name.localeCompare(b.name));
  return (
    <section className="pp-section" aria-labelledby="book-h">
      <h2 id="book-h">Book activities</h2>
      {!view.open && <p className="pp-muted">Booking is closed right now.</p>}
      {days.length > 1 && <DayChips days={days} value={day} today={today} onChange={setDay} labels={{ any: 'Any time' }} />}
      {list.length === 0 ? (
        <p className="pp-muted">Nothing to book on this day.</p>
      ) : (
        <ul className="pp-rows">
          {list.map((s) => {
            const b = bookings.get(s.id);
            const clash = !b && clashWith(s);
            const working = busy && pressed === s.id;
            return (
              <li key={s.id} className={b ? 'pp-row is-booked' : 'pp-row'}>
                <span className="pp-row-time pp-num">{s.startsAt ? timeInZone(s.startsAt, tz) : 'Any'}</span>
                <span className="pp-row-main">
                  <strong>{s.name}</strong>
                  <span>{clash ? `Clashes with ${clash.name}` : [s.startsAt && s.endsAt ? `until ${timeInZone(s.endsAt, tz)}` : null, s.location].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="pp-row-action">
                  {b ? (
                    b.canCancel && view.open ? (
                      <button
                        type="button"
                        className="pp-state is-booked"
                        disabled={busy}
                        onClick={() => {
                          setPressed(s.id);
                          onCancel(s.id);
                        }}
                      >
                        <Icon name="check" size={16} />
                        {working ? 'Cancelling' : 'Booked'}
                        <span className="pp-state-sub">{working ? '' : 'Tap to cancel'}</span>
                        <span className="visually-hidden"> {s.name}. Tap to cancel.</span>
                      </button>
                    ) : (
                      <span className="pp-state is-booked">
                        <Icon name="check" size={16} /> Booked
                      </span>
                    )
                  ) : s.full ? (
                    <span className="pp-state is-full">Full</span>
                  ) : !view.open ? (
                    <span className="pp-state is-off">Not booked</span>
                  ) : (
                    <button
                      type="button"
                      className="pp-state is-book"
                      disabled={busy || !!clash}
                      onClick={() => {
                        setPressed(s.id);
                        onBook(s);
                      }}
                    >
                      {working ? 'Booking' : 'Book'}
                      <span className="visually-hidden"> {s.name}</span>
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Meals one day at a time, with what's in them shown straight away. */
function Food({ meals, tz }: { meals: ProgrammeItem[]; tz: string }) {
  const today = todayInZone(tz);
  const timed = meals.filter((m) => m.startsAt).sort((a, b) => startOf(a) - startOf(b));
  const days = [...new Set(timed.map((m) => dayInZone(m.startsAt!, tz)))];
  const [day, setDay] = useState(() => (days.includes(today) ? today : (days.find((d) => d > today) ?? days[0] ?? today)));
  return (
    <section className="pp-section" aria-labelledby="food-h">
      <h2 id="food-h">Food</h2>
      {days.length > 1 && <DayChips days={days} value={day} today={today} onChange={setDay} />}
      <ul className="pp-food">
        {timed
          .filter((m) => dayInZone(m.startsAt!, tz) === day)
          .map((m, i) => (
            <li key={i}>
              <span className="pp-tl-time pp-num">{timeInZone(m.startsAt!, tz)}</span>
              <span className="pp-food-main">
                <strong>{m.name}</strong>
                <span>{m.menu || 'Menu to come'}</span>
                {m.ingredients && <small>{m.ingredients}</small>}
              </span>
            </li>
          ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- the side quest

/** Their quest progress, once they've found the game. */
function QuestCard({ quest }: { quest: SideQuestStanding }) {
  return (
    <section className="pp-quest" aria-labelledby="quest-h">
      <div className="pp-quest-head">
        <h2 id="quest-h">Super Splash Side Quest</h2>
        {quest.rank !== null && <span className="pp-rank">{ordinal(quest.rank)} of {quest.players}</span>}
      </div>
      <p className="pp-quest-big">
        <span className="pp-num">{quest.collected}</span>
        <span>
          friend{quest.collected === 1 ? '' : 's'} collected
          <small>
            {quest.collected} of {quest.total} at camp
          </small>
        </span>
      </p>
      <QuestList quests={quest.quests} />
      {quest.board.length > 1 && <Board board={quest.board} />}
      <p className="pp-quest-hint">Scan someone’s lanyard with your phone camera to collect them.</p>
    </section>
  );
}

function QuestList({ quests, highlight }: { quests: SideQuestStanding['quests']; highlight?: string }) {
  return (
    <ul className="pp-quests">
      {quests.map((q) => (
        <li key={q.key} className={[q.done && 'is-done', highlight === q.key && 'is-highlight'].filter(Boolean).join(' ')}>
          <span className="pp-quest-name">
            {q.done ? <Icon name="check" size={18} /> : null}
            {q.done ? `Collected every one: ${q.label}` : `Collect all ${q.label}`}
          </span>
          <span className="pp-num pp-quest-count">
            {q.collected}/{q.total}
          </span>
          {q.total <= 24 ? (
            <span className="pp-slots" aria-hidden="true">
              {Array.from({ length: q.total }, (_, i) => (
                <span key={i} className={i < q.collected ? 'is-filled' : undefined} />
              ))}
            </span>
          ) : (
            <span className="pp-meter" aria-hidden="true">
              <span style={{ width: `${(q.collected / q.total) * 100}%` }} />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Board({ board }: { board: SideQuestStanding['board'] }) {
  return (
    <ol className="pp-board" aria-label="Side Quest table">
      {board.map((b, i) => (
        <li key={i} className={b.isYou ? 'is-you' : undefined}>
          <span className="pp-board-place pp-num">{ordinal(b.place)}</span>
          <span className="pp-board-name">{b.isYou ? `${b.name} (you)` : b.name}</span>
          <span className="pp-board-n pp-num">{b.collected}</span>
        </li>
      ))}
    </ol>
  );
}

const SECTION_QUEST: Record<string, string> = { Joeys: 'joeys', Cubs: 'cubs', Scouts: 'scouts', Venturers: 'venturers', Rovers: 'rovers', Leaders: 'leaders' };

/**
 * The moment of collecting someone: a full-screen splash with the count
 * rising to the new total. A repeat gets a softer, comic sheet instead.
 */
function CollectScreen({ result, onDone, onMine }: { result: CollectResult; onDone: () => void; onMine: () => void }) {
  const s = result.standing;
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [shown, setShown] = useState(result.fresh && !reduced ? Math.max(0, s.collected - 1) : s.collected);
  const done = useRef<HTMLButtonElement>(null);
  const questKey = result.friend.sectionWord === 'Adult' ? 'leaders' : (SECTION_QUEST[result.friend.section] ?? '');
  const quest = s.quests.find((q) => q.key === questKey);
  const milestone = result.fresh && (s.collected === 1 || s.collected % 10 === 0 || (quest?.done && quest.collected === quest.total));

  useEffect(() => {
    done.current?.focus();
    if (!result.fresh) return;
    // Phones only allow a buzz after the person has tapped something.
    if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(40);
    if (reduced) return;
    // Count up to the new total.
    const from = Math.max(0, s.collected - 1);
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 700);
      setShown(Math.round(from + (s.collected - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [result.fresh, s.collected, reduced]);

  if (!result.fresh) {
    return (
      <div className="pp pp-repeat" role="dialog" aria-modal="true" aria-labelledby="repeat-h">
        <div className="pp-sheet">
          <p className="pp-marker" id="repeat-h">
            Bah bahhhh!
          </p>
          <p className="pp-sheet-lead">You’ve already collected {result.friend.firstName}.</p>
          <p className="pp-muted">
            {s.total - s.collected > 0 ? `${s.total - s.collected} still to find. Go and collect someone new.` : 'You’ve collected everyone at camp. Legend.'}
          </p>
          <button ref={done} type="button" className="pp-btn" onClick={onDone}>
            Keep collecting
          </button>
          <button type="button" className="pp-link pp-not-friend" onClick={onMine}>
            This is my card, not a friend’s
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={milestone ? 'pp pp-splash is-milestone' : 'pp pp-splash'} role="dialog" aria-modal="true" aria-labelledby="splash-h">
      {milestone && (
        <div className="pp-drops" aria-hidden="true">
          {Array.from({ length: 18 }, (_, i) => (
            <span key={i} style={{ ['--i' as string]: i }} />
          ))}
        </div>
      )}
      <div className="pp-splash-body">
        <p className="pp-splash-kicker">Super Splash Side Quest</p>
        <h1 id="splash-h">
          {s.collected === 1 ? 'You found the side quest!' : 'Splash!'} You collected {result.friend.firstName}.
        </h1>
        <p className="pp-splash-count" aria-live="polite">
          <span className="pp-num">{shown}</span>
          <span>friend{s.collected === 1 ? '' : 's'} collected</span>
        </p>
        <p className="pp-splash-of">
          {s.collected} of {s.total} at camp
        </p>
        {s.rank !== null && (
          <p className="pp-rank pp-rank-big">
            You’re {ordinal(s.rank)} on the Side Quest table
          </p>
        )}
        {quest && (
          <div className="pp-splash-quest">
            <QuestList quests={[quest]} highlight={quest.key} />
          </div>
        )}
        {s.collected === 1 && <p className="pp-splash-hint">Every lanyard you scan with your phone camera adds a friend. Keep it a secret… or don’t.</p>}
        <button ref={done} type="button" className="pp-btn pp-btn-sun" onClick={onDone}>
          Keep collecting
        </button>
        <button type="button" className="pp-link pp-link-light" onClick={onMine}>
          This is my card, not a friend’s
        </button>
      </div>
    </div>
  );
}
