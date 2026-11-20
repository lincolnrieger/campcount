import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { SECTION_COLOURS } from '../../shared/lanyardDesign';
import { dayInZone, dayLabel, timeInZone, timeRange, todayInZone } from '../../shared/time';
import { api } from '../api';
import type { CollectResult, ProgrammeItem, SideQuestStanding, SignupSession, SignupView } from '../components/SignupPanel';
import { TeamsPanel } from '../components/TeamsPanel';
import { loadFont } from '../lanyards/fonts';
import { useTitle } from '../shell';
import { useSiteEvent } from '../site';
import { Icon, formatDateRange } from '../ui';
import { BrandMark } from '../ui/AppShell';
import { SiteLogo } from '../ui/SiteShell';
import { SignupStatus, usePerson } from './Signup';

/**
 * A camper's own page: the QR on their lanyard, opened on a phone. It's the
 * one screen most people at camp ever see, so it has its own, brighter look
 * ("Super Splash"): a pass at the top, what's on now, then their day,
 * booking, teams and food on one scrolling page.
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
  if (state === 'loading' || !person.view)
    return (
      <Shell>
        <div className="pp-pass pp-pass-loading" aria-busy="true" aria-label="Loading your camp page">
          <span className="pp-skel pp-skel-name" />
          <span className="pp-skel pp-skel-line" />
        </div>
      </Shell>
    );
  return (
    <Shell>
      <Page view={person.view} busy={person.busy} actions={person} />
      <SignupStatus error={error} done={person.done} />
    </Shell>
  );
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

function inWords(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `in ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `in ${h} h ${m} min` : `in ${h} h`;
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

// ---------------------------------------------------------------- the page

type Actions = ReturnType<typeof usePerson>;

function Page({ view, busy, actions }: { view: SignupView; busy: boolean; actions: Actions }) {
  const tz = view.event.timezone;
  const now = useNow();
  const programme = view.programme ?? [];
  const mine = useMemo(() => new Set(view.bookings.map((b) => key(b))), [view.bookings]);
  const meals = programme.filter((i) => i.kind === 'meal');
  const teamEvents = view.teamEvents ?? [];
  const canBook = view.open && view.sessions.length > 0;
  const quest = view.sideQuest && view.sideQuest.collected > 0 ? view.sideQuest : null;

  const sections = [
    { id: 'my-day', label: 'My day' },
    ...(canBook || view.bookings.length ? [{ id: 'book', label: 'Book' }] : []),
    ...(teamEvents.length ? [{ id: 'teams', label: 'Teams' }] : []),
    ...(meals.length ? [{ id: 'food', label: 'Food' }] : []),
  ];

  return (
    <>
      <Pass view={view} quest={quest} />
      <NowNext items={programme} mine={mine} now={now} tz={tz} />
      {quest && <QuestCard quest={quest} />}
      <SectionNav sections={sections} />
      <MyDay items={programme} mine={mine} now={now} tz={tz} hasBookings={view.bookings.length > 0} />
      {(canBook || view.bookings.length > 0) && <Book view={view} busy={busy} onBook={actions.book} onCancel={actions.cancel} />}
      {teamEvents.length > 0 && (
        <section className="pp-section" id="teams" aria-labelledby="teams-h">
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
      {meals.length > 0 && <Food meals={meals} tz={tz} />}
      <footer className="pp-footer">
        <p>Lost your lanyard? Tell a leader straight away. Anyone holding it can be scanned as you.</p>
      </footer>
    </>
  );
}

/** The pass: who you are, at which camp. Coloured like your section's lanyard band. */
function Pass({ view, quest }: { view: SignupView; quest: SideQuestStanding | null }) {
  const siteEvent = useSiteEvent();
  const word = view.person.sectionWord ?? 'Scout';
  const colour = SECTION_COLOURS[word]?.bg ?? '#00843D';
  const first = view.person.firstName ?? view.person.name.split(' ')[0];
  const done = view.activitiesDone ?? 0;
  return (
    <header className="pp-pass" style={{ ['--pass' as string]: colour }}>
      <div className="pp-pass-top">
        <span className="pp-pass-logo">{siteEvent ? <SiteLogo size={32} /> : <BrandMark size={32} />}</span>
        <span className="pp-pass-camp">
          <strong>{view.event.name}</strong>
          <span>{formatDateRange(view.event.startsOn, view.event.endsOn)}</span>
        </span>
      </div>
      <h1 className="pp-name">{first}</h1>
      <p className="pp-pass-who">
        <span className="pp-section-pill">{view.person.section && view.person.section !== 'Other' ? view.person.section : word}</span>
        {view.person.groupName && <span>{view.person.groupName}</span>}
      </p>
      <dl className="pp-stats">
        <div>
          <dt>Activities done</dt>
          <dd className="pp-num">{done}</dd>
        </div>
        <div>
          <dt>Booked</dt>
          <dd className="pp-num">{view.bookings.length}</dd>
        </div>
        {quest && (
          <div>
            <dt>Friends collected</dt>
            <dd className="pp-num">{quest.collected}</dd>
          </div>
        )}
      </dl>
      <svg className="pp-wave" viewBox="0 0 400 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d="M0 14 C 40 4, 80 4, 120 12 S 200 22, 240 12 S 320 2, 360 10 S 400 16, 400 16 V24 H0 Z" />
      </svg>
    </header>
  );
}

/** What's on now and next, so a glance answers "where should I be?". */
function NowNext({ items, mine, now, tz }: { items: ProgrammeItem[]; mine: Set<string>; now: number; tz: string }) {
  const timed = items.filter((i) => i.startsAt).sort((a, b) => startOf(a) - startOf(b));
  // Your own bookings win over everything else on at the same time.
  const rank = (i: ProgrammeItem) => (mine.has(key(i)) ? 0 : i.kind === 'meal' ? 1 : 2);
  const current = timed.filter((i) => now >= startOf(i) - 5 * 60_000 && now < endOf(i)).sort((a, b) => rank(a) - rank(b))[0];
  const upcoming = timed.filter((i) => startOf(i) > now && i !== current).sort((a, b) => startOf(a) - startOf(b) || rank(a) - rank(b))[0];
  if (!current && !upcoming) return null;
  const row = (label: string, it: ProgrammeItem, when: string) => (
    <li className={mine.has(key(it)) ? 'pp-nn is-mine' : 'pp-nn'}>
      <span className="pp-nn-label">
        {label === 'Now' && <span className="pp-live" aria-hidden="true" />}
        {label}
      </span>
      <span className="pp-nn-main">
        <strong>{it.name}</strong>
        <span>{[when, it.location].filter(Boolean).join(' · ')}</span>
      </span>
      {mine.has(key(it)) && (
        <span className="pp-tag pp-tag-booked">
          <Icon name="check" size={16} /> Booked
        </span>
      )}
    </li>
  );
  const today = todayInZone(tz);
  const nextWhen = (it: ProgrammeItem) => {
    const d = dayInZone(it.startsAt!, tz);
    const t = timeInZone(it.startsAt!, tz);
    return d === today ? `${t}, ${inWords(startOf(it) - now)}` : `${dayLabel(d)}, ${t}`;
  };
  return (
    <section className="pp-nownext" aria-label="Now and next">
      <ul>
        {current && row('Now', current, current.endsAt ? `until ${timeInZone(current.endsAt, tz)}` : '')}
        {upcoming && row('Next', upcoming, nextWhen(upcoming))}
      </ul>
    </section>
  );
}

/** Jump links to each part of the page; the one you're looking at is marked. */
function SectionNav({ sections }: { sections: { id: string; label: string }[] }) {
  const [active, setActive] = useState(sections[0]?.id);
  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: '-80px 0px -60% 0px' },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [sections]);
  if (sections.length < 2) return null;
  return (
    <nav className="pp-nav" aria-label="On this page">
      {sections.map((s) => (
        <a key={s.id} href={`#${s.id}`} aria-current={active === s.id ? 'true' : undefined} onClick={(e) => {
          e.preventDefault();
          document.getElementById(s.id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
          setActive(s.id);
        }}>
          {s.label}
        </a>
      ))}
    </nav>
  );
}

/** The day's programme. Day chips across the top; "Just mine" shows only what you've booked (and meals). */
function MyDay({ items, mine, now, tz, hasBookings }: { items: ProgrammeItem[]; mine: Set<string>; now: number; tz: string; hasBookings: boolean }) {
  const timed = items.filter((i) => i.startsAt).sort((a, b) => startOf(a) - startOf(b));
  const days = [...new Set(timed.map((i) => dayInZone(i.startsAt!, tz)))];
  const today = todayInZone(tz);
  const [day, setDay] = useState(() => (days.includes(today) ? today : (days.find((d) => d > today) ?? days[0] ?? today)));
  const [justMine, setJustMine] = useState(false);
  const list = timed.filter((i) => dayInZone(i.startsAt!, tz) === day).filter((i) => !justMine || mine.has(key(i)) || i.kind === 'meal');
  return (
    <section className="pp-section" id="my-day" aria-labelledby="my-day-h">
      <div className="pp-section-head">
        <h2 id="my-day-h">My day</h2>
        {hasBookings && (
          <div className="pp-toggle" role="group" aria-label="Show">
            <button type="button" aria-pressed={!justMine} onClick={() => setJustMine(false)}>
              Everything
            </button>
            <button type="button" aria-pressed={justMine} onClick={() => setJustMine(true)}>
              Just mine
            </button>
          </div>
        )}
      </div>
      {days.length > 1 && <DayChips days={days} value={day} today={today} onChange={setDay} />}
      {timed.length === 0 ? (
        <p className="pp-muted">The programme hasn’t been added yet. Check back closer to camp.</p>
      ) : list.length === 0 ? (
        <p className="pp-muted">Nothing booked on this day yet.</p>
      ) : (
        <ol className="pp-timeline">
          {list.map((it, i) => {
            const past = endOf(it) < now;
            const isMine = mine.has(key(it));
            return (
              <li key={i} className={['pp-tl', past && 'is-past', isMine && 'is-mine', it.kind === 'meal' && 'is-meal'].filter(Boolean).join(' ')}>
                <span className="pp-tl-time pp-num">{timeInZone(it.startsAt!, tz)}</span>
                <span className="pp-tl-main">
                  <strong>{it.name}</strong>
                  <span>{[it.endsAt ? `until ${timeInZone(it.endsAt, tz)}` : null, it.location, it.kind === 'meal' ? 'Meal' : null].filter(Boolean).join(' · ')}</span>
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

function DayChips({ days, value, today, onChange }: { days: string[]; value: string; today: string; onChange: (d: string) => void }) {
  return (
    <div className="pp-days" role="group" aria-label="Day">
      {days.map((d) => (
        <button key={d} type="button" aria-pressed={d === value} onClick={() => onChange(d)}>
          {d === today ? 'Today' : dayLabel(d)}
        </button>
      ))}
    </div>
  );
}

/** Your bookings, then what you can still book. */
function Book({ view, busy, onBook, onCancel }: { view: SignupView; busy: boolean; onBook: (s: SignupSession) => void; onCancel: (id: string) => void }) {
  const tz = view.event.timezone;
  const booked = new Set(view.bookings.map((b) => b.activityId));
  const days = [...new Set(view.sessions.map((s) => (s.startsAt ? dayInZone(s.startsAt, tz) : 'any')))].sort((a, b) => (a === 'any' ? 1 : b === 'any' ? -1 : a.localeCompare(b)));
  const today = todayInZone(tz);
  const [day, setDay] = useState(() => (days.includes(today) ? today : (days.find((d) => d !== 'any' && d > today) ?? days[0] ?? 'any')));
  const mine = [...view.bookings].sort((a, b) => (a.startsAt ?? '9').localeCompare(b.startsAt ?? '9'));
  const clashWith = (s: SignupSession) => {
    if (!s.startsAt) return null;
    const a0 = startOf(s);
    const a1 = endOf(s);
    return view.bookings.find((b) => b.activityId !== s.id && b.startsAt && startOf(b) < a1 && endOf(b) > a0) ?? null;
  };
  const list = view.sessions.filter((s) => !booked.has(s.id) && (s.startsAt ? dayInZone(s.startsAt, tz) : 'any') === day);
  return (
    <section className="pp-section" id="book" aria-labelledby="book-h">
      <h2 id="book-h">Book activities</h2>
      {mine.length > 0 && (
        <ul className="pp-cards">
          {mine.map((b) => (
            <li key={b.activityId} className="pp-card is-booked">
              <span className="pp-card-when pp-num">{b.startsAt ? `${dayLabel(dayInZone(b.startsAt, tz))}, ${timeRange(b.startsAt, b.endsAt, tz)}` : 'Any time'}</span>
              <strong className="pp-card-title">{b.name}</strong>
              {b.location && <span className="pp-card-where">{b.location}</span>}
              <span className="pp-card-foot">
                <span className="pp-tag pp-tag-booked">
                  <Icon name="check" size={16} /> Booked
                </span>
                {b.canCancel && (
                  <button type="button" className="pp-link" disabled={busy} onClick={() => onCancel(b.activityId)}>
                    Cancel<span className="visually-hidden"> {b.name}</span>
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!view.open ? (
        <p className="pp-muted">Booking is closed right now.</p>
      ) : (
        <>
          <h3 className="pp-subhead">{mine.length ? 'Book something else' : 'Pick what you want to do'}</h3>
          {days.length > 1 && <DayChips days={days.filter((d) => d !== 'any')} value={day} today={today} onChange={setDay} />}
          {days.includes('any') && days.length > 1 && (
            <button type="button" className="pp-link pp-anytime" aria-pressed={day === 'any'} onClick={() => setDay('any')}>
              Activities you can do any time
            </button>
          )}
          {list.length === 0 ? (
            <p className="pp-muted">Nothing else to book on this day.</p>
          ) : (
            <ul className="pp-cards">
              {list.map((s) => {
                const clash = clashWith(s);
                const left = s.capacity === null ? null : Math.max(0, s.capacity - s.booked);
                return (
                  <li key={s.id} className={['pp-card', s.full && 'is-full', clash && 'is-clash'].filter(Boolean).join(' ')}>
                    <span className="pp-card-when pp-num">{s.startsAt ? timeRange(s.startsAt, s.endsAt, tz) : 'Any time'}</span>
                    <strong className="pp-card-title">{s.name}</strong>
                    {s.location && <span className="pp-card-where">{s.location}</span>}
                    {s.capacity !== null && (
                      <span className="pp-meter" aria-hidden="true">
                        <span style={{ width: `${Math.min(100, (s.booked / s.capacity) * 100)}%` }} />
                      </span>
                    )}
                    <span className="pp-card-places">{left === null ? 'Plenty of room' : left === 0 ? 'Full' : `${left} ${left === 1 ? 'place' : 'places'} left`}</span>
                    {clash && <span className="pp-clash">Clashes with {clash.name}. Cancel that first if you’d rather do this.</span>}
                    {!s.full && (
                      <button type="button" className="pp-btn" disabled={busy || !!clash} onClick={() => onBook(s)}>
                        Book {s.name}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** Today's meals first, with what's in them behind a tap. */
function Food({ meals, tz }: { meals: ProgrammeItem[]; tz: string }) {
  const today = todayInZone(tz);
  const timed = meals.filter((m) => m.startsAt).sort((a, b) => startOf(a) - startOf(b));
  const days = [...new Set(timed.map((m) => dayInZone(m.startsAt!, tz)))].sort((a, b) => (a === today ? -1 : b === today ? 1 : a < today && b >= today ? 1 : b < today && a >= today ? -1 : a.localeCompare(b)));
  return (
    <section className="pp-section" id="food" aria-labelledby="food-h">
      <h2 id="food-h">Food</h2>
      <p className="pp-muted">If something clashes with your dietary needs, tell a leader.</p>
      {days.map((d) => (
        <div key={d} className="pp-food-day">
          <h3 className="pp-subhead">{d === today ? 'Today' : dayLabel(d, 'long')}</h3>
          <ul className="pp-food">
            {timed
              .filter((m) => dayInZone(m.startsAt!, tz) === d)
              .map((m, i) => (
                <li key={i}>
                  <span className="pp-tl-time pp-num">{timeInZone(m.startsAt!, tz)}</span>
                  <span className="pp-food-main">
                    <strong>{m.name}</strong>
                    <span>{m.menu || 'Menu to come'}</span>
                    {m.ingredients && (
                      <details>
                        <summary>What’s in it</summary>
                        <p>{m.ingredients}</p>
                      </details>
                    )}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------- the side quest

/** Their quest progress, once they've found the game. */
function QuestCard({ quest }: { quest: SideQuestStanding }) {
  return (
    <section className="pp-quest" id="quest" aria-labelledby="quest-h">
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
  const questKey = result.friend.sectionWord === 'Leader' ? 'leaders' : (SECTION_QUEST[result.friend.section] ?? '');
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
