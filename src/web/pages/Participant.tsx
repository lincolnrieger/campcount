import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { levelColours } from '../../shared/lanyardDesign';
import { textOn } from '../../shared/levels';
import { dayInZone, dayLabel, timeInZone, todayInZone } from '../../shared/time';
import { ApiFailure, api } from '../api';
import { loadSnapshot, saveSnapshot } from '../offline/db';
import type { ParticipantItem } from '../../shared/mealItems';
import { MEAL_CATEGORIES } from '../../shared/mealItems';
import type { LinkFeature } from '../../shared/participantLinks';
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
 * (the camp pass): a small pass at the top, then one tab at a time
 * (My day, Book, Teams, Food, and the Side Quest once found).
 *
 * If the camp plays the Side Quest and this phone already belongs to someone
 * else, opening a card collects that person instead (see CollectScreen).
 */
export function Participant() {
  useTitle('My camp');
  const [token] = useState(() => window.location.hash.slice(1));
  const [state, setState] = useState<'loading' | 'page' | 'collect' | 'nocard' | 'inactive' | 'offline'>('loading');
  // No signal (common at camp): the page as it was last opened on this phone.
  const [saved, setSaved] = useState<Saved | null>(null);
  const slow = useDelayed(1000, state === 'loading');
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

  /** Offline: show the last copy of this card's page, if this phone has one. */
  const showSaved = useCallback(async (err: unknown, forToken: string | null) => {
    if (!(err instanceof ApiFailure && err.status === 0)) return false;
    const copy = await loadSnapshot<Saved>(SAVED_KEY).catch(() => undefined);
    if (!copy || (forToken && copy.token !== forToken)) return false;
    setSaved(copy);
    setState('offline');
    return true;
  }, []);

  const showMine = useCallback(async () => {
    setState('loading');
    try {
      setView(await api<SignupView>('/public/signup/me', { body: {} }));
      // The friend's card link isn't theirs: leave a clean address they can come back to.
      window.history.replaceState(null, '', '/c');
      setState('page');
    } catch (err) {
      if (!(await showSaved(err, null))) setState('nocard');
    }
  }, [setView, showSaved]);

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
      } catch (err) {
        if (!(await showSaved(err, token))) setState('inactive');
      }
    },
    [token, setView, showSaved],
  );

  // Keep a copy of the page on this phone for when there's no signal.
  useEffect(() => {
    if (state === 'page' && person.view) void saveSnapshot(SAVED_KEY, { view: person.view, at: Date.now(), token: token || null } satisfies Saved).catch(() => undefined);
  }, [state, person.view, token]);

  useEffect(() => {
    if (/^[A-Za-z0-9_-]{22}$/.test(token)) void open();
    else void showMine();
  }, [token, open, showMine]);

  if (state === 'offline' && saved)
    return (
      <Shell>
        <div className="pp-offline" role="status">
          <Icon name="offline" size={20} />
          <span>
            No signal. This is your page from <strong>{timeInZone(new Date(saved.at).toISOString(), saved.view.event.timezone)}</strong>.
          </span>
          <button type="button" className="pp-link" onClick={() => void (/^[A-Za-z0-9_-]{22}$/.test(token) ? open() : showMine())}>
            Retry
          </button>
        </div>
        {/* Busy: nothing can be booked or changed until the page is back online. */}
        <Page view={saved.view} busy actions={person} />
      </Shell>
    );
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
        {/* Nothing for the first second (most loads are quicker), then a quiet line. */}
        <p className={slow ? 'pp-loading' : 'visually-hidden'} role="status" aria-busy="true">
          Opening your camp page…
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

const SAVED_KEY = 'pp-last-page';
interface Saved {
  view: SignupView;
  at: number;
  token: string | null;
}

/** True once `ms` have passed while `active` (reset when it stops). */
function useDelayed(ms: number, active: boolean) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setLate(true), ms);
    return () => {
      clearTimeout(t);
      setLate(false);
    };
  }, [ms, active]);
  return late;
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
 * Someone's page, opened another way than their own lanyard (a booking link):
 * the same tabs, starting on Book, with a line saying what just happened.
 */
export function ParticipantPage({
  view,
  busy,
  actions,
  error,
  notice,
  initialTab = 'book',
  onNotMe,
}: {
  view: SignupView;
  busy: boolean;
  actions: Actions;
  error: string | null;
  notice: { ok: boolean; text: string } | null;
  initialTab?: Tab;
  /** Typed-number pages: close this page and type another number. */
  onNotMe?: () => void;
}) {
  useEffect(() => {
    void loadFont('bebas-neue', 400);
  }, []);
  return (
    <Shell>
      {notice && (
        <p className={notice.ok ? 'pp-link-notice is-ok' : 'pp-link-notice is-error'} role="status">
          <Icon name={notice.ok ? 'success' : 'warning'} size={20} />
          {notice.text}
        </p>
      )}
      <Page view={view} busy={busy} actions={actions} initialTab={initialTab} onNotMe={onNotMe} />
      <SignupStatus error={error} done={null} />
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

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

// ---------------------------------------------------------------- the page

type Actions = ReturnType<typeof usePerson>;
export type Tab = 'roster' | 'day' | 'book' | 'teams' | 'food' | 'quest';

/**
 * One tab at a time, picked from the bar at the bottom, so nothing is a
 * long scroll. Buttons change in place (Book → Booked) rather than popping
 * anything up, so the screen never jumps.
 */
function Page({ view, busy, actions, initialTab, onNotMe }: { view: SignupView; busy: boolean; actions: Actions; initialTab?: Tab; onNotMe?: () => void }) {
  const tz = view.event.timezone;
  const now = useNow();
  const programme = view.programme ?? [];
  const mine = useMemo(() => new Set(view.bookings.map((b) => key(b))), [view.bookings]);
  const meals = programme.filter((i) => i.kind === 'meal');
  const teamEvents = view.teamEvents ?? [];
  // Leaders don't book activities, so they don't get the Book tab.
  // Adults (per the camp's youth levels setting) don't book activities.
  const isAdult = view.person.kind ? view.person.kind === 'adult' : view.person.levelWord === 'Leader';
  // A link for everyone can switch parts off (the server leaves their data out too).
  const has = (f: LinkFeature) => !view.features || view.features.includes(f);
  const canBook = has('book') && !isAdult && (view.sessions.length > 0 || view.bookings.length > 0);
  const quest = view.sideQuest && view.sideQuest.collected > 0 ? view.sideQuest : null;

  const duties = view.duties ?? [];
  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    // Leaders on the roster see their duties first.
    ...(duties.length ? [{ id: 'roster' as const, label: 'Roster', icon: 'clipboard' as const }] : []),
    ...(has('programme') ? [{ id: 'day' as const, label: 'My day', icon: 'events' as const }] : []),
    ...(canBook ? [{ id: 'book' as const, label: 'Book', icon: 'ticket' as const }] : []),
    ...(teamEvents.length ? [{ id: 'teams' as const, label: 'Teams', icon: 'team' as const }] : []),
    ...(meals.length ? [{ id: 'food' as const, label: 'Food', icon: 'meal' as const }] : []),
    ...(quest ? [{ id: 'quest' as const, label: 'Quest', icon: 'star' as const }] : []),
  ];
  const [tab, setTabState] = useState<Tab>(() => {
    if (initialTab) return initialTab;
    const saved = sessionStorage.getItem('cc-pp-tab') as Tab | null;
    return saved ?? (duties.length ? 'roster' : 'day');
  });
  const current = tabs.some((t) => t.id === tab) ? tab : (tabs[0]?.id ?? null);
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
        {current === 'day' && <MyDay items={programme} mine={mine} now={now} tz={tz} onBook={canBook && view.open && view.sessions.length > 0 ? () => setTab('book') : undefined} />}
        {current === 'book' && <Book view={view} busy={busy} onBook={actions.book} onCancel={actions.cancel} />}
        {current === 'teams' && (
          <section className="pp-section" aria-labelledby="teams-h">
            <h2 id="teams-h">Teams</h2>
            <div className="pp-teams">
              <TeamsPanel
                teamEvents={teamEvents}
                tz={tz}
                busy={busy}
                onCreate={(id, name, locked) => actions.createTeam(id, name, locked)}
                onJoin={(id, name) => actions.joinTeam(id, name)}
                onJoinCode={(id, code) => actions.joinTeamWithCode(id, code)}
                onLeave={(id) => actions.leaveTeam(id)}
              />
            </div>
          </section>
        )}
        {current === 'food' && <Food meals={meals} tz={tz} pass={view.pass} />}
        {current === 'quest' && quest && <QuestCard quest={quest} />}
        {current === null && (
          <section className="pp-section">
            <p className="pp-muted">Nothing to show here yet. Check back closer to camp.</p>
          </section>
        )}
        <PageFoot email={view.event.contactEmail} onNotMe={onNotMe} />
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

/** Questions go to the camp's email; typed-number pages can be closed for the next person. */
function PageFoot({ email, onNotMe }: { email?: string; onNotMe?: () => void }) {
  if (!email && !onNotMe) return null;
  return (
    <footer className="pp-foot">
      {email && (
        <p>
          Questions or changes? Email <a href={`mailto:${email}`}>{email}</a>
        </p>
      )}
      {onNotMe && (
        <button type="button" className="pp-link" onClick={onNotMe}>
          Not you? Use a different participant ID
        </button>
      )}
    </footer>
  );
}

const nameSize = (name: string) => (name.length <= 12 ? 'is-l' : name.length <= 20 ? 'is-m' : 'is-s');

/** Who you are, at which camp. Coloured like your level's lanyard band. */
function Pass({ view }: { view: SignupView }) {
  const word = view.person.levelWord ?? '';
  const colour = view.person.levelColour ?? levelColours(word).bg;
  const first = view.person.firstName ?? view.person.name.split(' ')[0];
  const last = view.person.lastName ?? '';
  // No signal (the saved copy): the camp's name instead of a broken picture.
  const [bannerFailed, setBannerFailed] = useState(false);
  const banner = bannerFailed ? null : view.event.banner;
  return (
    <header className="pp-pass" style={{ ['--pass' as string]: colour }}>
      {banner ? (
        // The camp's own graphic stands in for its name.
        <img className="pp-banner" src={banner.url} width={banner.width} height={banner.height} alt={view.event.name} onError={() => setBannerFailed(true)} />
      ) : (
        <p className="pp-pass-camp">
          <strong>{view.event.name}</strong>
          <span>{formatDateRange(view.event.startsOn, view.event.endsOn)}</span>
        </p>
      )}
      {/* One line, one size: smaller for longer names so they still fit. */}
      <h1 className={`pp-name ${nameSize(`${first} ${last}`.trim())}`}>
        {first}
        {last && ` ${last}`}
      </h1>
      {word && <span className="pp-section-tag">{word}</span>}
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

/** The item on now, or else the next one, and how to say it ("On now", "In 25 min", "Next"). */
function nowNext(timed: ProgrammeItem[], now: number): { item: ProgrammeItem; label: string } | null {
  const on = timed.find((i) => startOf(i) <= now && endOf(i) > now);
  if (on) return { item: on, label: 'On now' };
  const next = timed.find((i) => startOf(i) > now);
  if (!next) return null;
  const mins = Math.round((startOf(next) - now) / 60_000);
  return { item: next, label: mins <= 90 ? `Next · in ${Math.max(1, mins)} min` : 'Next' };
}

/**
 * The day's programme, one day at a time. Your bookings say "Booked"; what's
 * on now (or next) is marked. Rows are information only, so they don't look
 * tappable.
 */
function MyDay({ items, mine, now, tz, onBook }: { items: ProgrammeItem[]; mine: Set<string>; now: number; tz: string; onBook?: () => void }) {
  const timed = items.filter((i) => i.startsAt).sort((a, b) => startOf(a) - startOf(b));
  const days = [...new Set(timed.map((i) => dayInZone(i.startsAt!, tz)))];
  const today = todayInZone(tz);
  const [day, setDay] = useState(() => (days.includes(today) ? today : (days.find((d) => d > today) ?? days[0] ?? today)));
  const list = timed.filter((i) => dayInZone(i.startsAt!, tz) === day);
  const marker = nowNext(timed, now);
  return (
    <section className="pp-section" aria-labelledby="my-day-h">
      <h2 id="my-day-h">My day</h2>
      {onBook && mine.size === 0 && (
        <div className="pp-nudge">
          <p>You haven’t booked any activities yet.</p>
          <button type="button" className="pp-link" onClick={onBook}>
            Book activities
          </button>
        </div>
      )}
      {days.length > 1 && <DayChips days={days} value={day} today={today} onChange={setDay} />}
      {timed.length === 0 ? (
        <p className="pp-muted">The programme hasn’t been added yet. Check back closer to camp.</p>
      ) : (
        <ol key={day} className="pp-timeline pp-swap">
          {list.map((it, i) => {
            const isMine = mine.has(key(it));
            const mark = marker?.item === it ? marker.label : null;
            return (
              <li
                key={i}
                aria-current={mark ? 'time' : undefined}
                className={['pp-tl', `is-${it.kind}`, endOf(it) < now && !mark && 'is-past', isMine && 'is-mine', mark && 'is-now'].filter(Boolean).join(' ')}
              >
                <span className="pp-tl-time pp-num">{timeInZone(it.startsAt!, tz)}</span>
                <span className="pp-tl-main">
                  {mark && <span className="pp-tl-mark">{mark}</span>}
                  <strong>
                    {it.kind !== 'program' && (
                      <span className="pp-tl-kind" aria-hidden="true">
                        <Icon name={it.kind === 'meal' ? 'meal' : 'ticket'} size={16} />
                      </span>
                    )}
                    {it.name}
                  </strong>
                  {it.location && (
                    <span className="pp-tl-where">
                      <Icon name="pin" size={14} />
                      {it.location}
                    </span>
                  )}
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

/** How full an activity is: "8 of 12 booked · 4 left", or "5 booked" with no limit. */
function fullness(s: SignupSession & { extra?: boolean }) {
  if (s.extra) return null;
  if (s.capacity === null) return `${s.booked} booked`;
  const left = Math.max(0, s.capacity - s.booked);
  return `${s.booked} of ${s.capacity} booked${left > 0 && left <= 5 ? ` · ${left} left` : ''}`;
}

/** Everything you're booked for, across every day, and a calendar file of it. */
function MyBookings({ view }: { view: SignupView }) {
  const tz = view.event.timezone;
  const list = [...view.bookings].sort((a, b) => (a.startsAt ?? '9').localeCompare(b.startsAt ?? '9'));
  const timed = list.filter((b) => b.startsAt);
  return (
    <details className="pp-mybook">
      <summary>
        <Icon name="check" size={18} />
        <span>
          You’re booked for <strong>{list.length}</strong> {list.length === 1 ? 'activity' : 'activities'}
        </span>
      </summary>
      <ul>
        {list.map((b) => (
          <li key={b.activityId}>
            <span className="pp-num">{b.startsAt ? `${dayLabel(dayInZone(b.startsAt, tz))} ${timeInZone(b.startsAt, tz)}` : 'Any time'}</span>
            <strong>{b.name}</strong>
          </li>
        ))}
      </ul>
      {timed.length > 0 && (
        <button type="button" className="pp-link" onClick={() => downloadCalendar(view.event.name, timed)}>
          <Icon name="download" size={18} /> Add to my calendar
        </button>
      )}
    </details>
  );
}

/** An .ics file of someone's bookings, for their phone's calendar. */
function downloadCalendar(camp: string, items: { activityId: string; name: string; location: string; startsAt: string | null; endsAt: string | null }[]) {
  const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (t: string) => t.replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
  const now = stamp(new Date().toISOString());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CampCount//Bookings//EN', 'CALSCALE:GREGORIAN'];
  for (const b of items) {
    const start = b.startsAt!;
    const end = b.endsAt ?? new Date(Date.parse(start) + 3_600_000).toISOString();
    lines.push(
      'BEGIN:VEVENT',
      `UID:${b.activityId}@campcount`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${esc(b.name)}`,
      ...(b.location ? [`LOCATION:${esc(b.location)}`] : []),
      `DESCRIPTION:${esc(camp)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${camp} bookings.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      {view.bookings.length > 0 && <MyBookings view={view} />}
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
                  <span>
                    {clash
                      ? `Clashes with ${clash.name}`
                      : [s.startsAt && s.endsAt ? `until ${timeInZone(s.endsAt, tz)}` : null, s.location].filter(Boolean).join(' · ')}
                  </span>
                  {fullness(s) && <span className={s.full ? 'pp-row-count is-full' : 'pp-row-count'}>{fullness(s)}</span>}
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

/**
 * Meals one day at a time. Each meal opens to its items by category; if
 * they have dietary needs recorded, items that conflict are marked (red:
 * contains, amber: may contain) with their alternative, and they can show
 * only what they can eat. Items load when Food is opened.
 */
function Food({ meals, tz, pass }: { meals: ProgrammeItem[]; tz: string; pass: string }) {
  const today = todayInZone(tz);
  const timed = meals.filter((m) => m.startsAt).sort((a, b) => startOf(a) - startOf(b));
  const days = [...new Set(timed.map((m) => dayInZone(m.startsAt!, tz)))];
  const [day, setDay] = useState(() => (days.includes(today) ? today : (days.find((d) => d > today) ?? days[0] ?? today)));
  const [data, setData] = useState<{ hasNeeds: boolean; meals: Record<string, ParticipantItem[]> } | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const anyItems = meals.some((m) => (m.itemCount ?? 0) > 0);
  useEffect(() => {
    if (!anyItems) return;
    let live = true;
    api<{ hasNeeds: boolean; meals: Record<string, ParticipantItem[]> }>('/public/signup/meals', { body: { pass } })
      .then((d) => live && setData(d))
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // Load once per visit to Food; the pass refreshes after every booking, which needn't reload this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyItems]);

  const itemRow = (it: ParticipantItem) => {
    const isOpen = open === it.id;
    const avoid = it.conflict === 'contains' ? it.contains : it.conflict === 'may_contain' ? it.mayContain : [];
    return (
      <li key={it.id} className={['pp-mi', it.conflict === 'contains' && 'is-no', it.conflict === 'may_contain' && 'is-maybe', it.forYou && 'is-yours'].filter(Boolean).join(' ')}>
        <button type="button" className="pp-mi-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : it.id)}>
          <span className="pp-mi-name">{it.name}</span>
          {it.conflict === 'contains' && <span className="pp-mi-flag is-no">Contains {avoid.join(', ')}</span>}
          {it.conflict === 'may_contain' && <span className="pp-mi-flag is-maybe">May contain {avoid.join(', ')}</span>}
          {it.forYou && <span className="pp-mi-flag is-yours">For you</span>}
          {it.tbc && <span className="pp-mi-flag">Ingredients TBC</span>}
        </button>
        {it.yourAlternative && <p className="pp-mi-alt">Your alternative: {it.yourAlternative}</p>}
        {it.isAlternative && (it.replaces || it.alternativeFor.length > 0) && (
          <p className="pp-mi-sub">{[it.replaces ? `Instead of ${it.replaces}` : null, it.alternativeFor.length ? `For ${it.alternativeFor.join(', ')}` : null].filter(Boolean).join(' · ')}</p>
        )}
        {isOpen && (
          <div className="pp-mi-detail">
            {it.ingredients ? <p>{it.ingredients}</p> : <p className="pp-muted">No ingredients listed.</p>}
            {(it.contains.length > 0 || it.mayContain.length > 0 || it.dietary.length > 0) && (
              <p className="pp-mi-labels">
                {[it.contains.length ? `Contains: ${it.contains.join(', ')}` : null, it.mayContain.length ? `May contain: ${it.mayContain.join(', ')}` : null, it.dietary.length ? `Suits: ${it.dietary.join(', ')}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
        )}
      </li>
    );
  };

  const groups = (list: ParticipantItem[]) =>
    MEAL_CATEGORIES.map((c) => [c, list.filter((i) => i.category === c)] as const)
      .filter(([, l]) => l.length > 0)
      .map(([c, l]) => {
        const flagged = l.filter((i) => i.conflict).length;
        return (
          <details key={c} className="pp-mi-cat">
            <summary>
              <span>{c}</span>
              <span className="pp-num pp-muted">{l.length}</span>
              {flagged > 0 && <span className="pp-mi-flag is-no">{flagged} to check</span>}
            </summary>
            <ul>{l.map(itemRow)}</ul>
          </details>
        );
      });

  return (
    <section className="pp-section" aria-labelledby="food-h">
      <h2 id="food-h">Food</h2>
      {days.length > 1 && <DayChips days={days} value={day} today={today} onChange={setDay} />}
      {data?.hasNeeds && (
        <label className="pp-only-mine">
          <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
          Show only what I can eat
        </label>
      )}
      <ul className="pp-food">
        {timed
          .filter((m) => dayInZone(m.startsAt!, tz) === day)
          .map((m, i) => {
            const items = (m.mealId && data?.meals[m.mealId]) || [];
            const main = items.filter((it) => !it.isAlternative && !(onlyMine && it.conflict === 'contains'));
            const alts = items.filter((it) => it.isAlternative && (!data?.hasNeeds || !onlyMine || it.forYou));
            return (
              <li key={i}>
                <span className="pp-tl-time pp-num">{timeInZone(m.startsAt!, tz)}</span>
                <span className="pp-food-main">
                  <strong>{m.name}</strong>
                  <span>{m.menu || 'Menu to come'}</span>
                  {m.ingredients && <small>{m.ingredients}</small>}
                  {(m.itemCount ?? 0) > 0 && !data && <small className="pp-muted">Loading what’s in it…</small>}
                  {main.length > 0 && <div className="pp-mi-groups">{groups(main)}</div>}
                  {alts.length > 0 && (
                    <details className="pp-mi-cat pp-mi-alts" open={!!data?.hasNeeds && alts.some((a) => a.forYou)}>
                      <summary>
                        <span>Dietary alternatives</span>
                        <span className="pp-num pp-muted">{alts.length}</span>
                      </summary>
                      <ul>{alts.map(itemRow)}</ul>
                    </details>
                  )}
                </span>
              </li>
            );
          })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- the side quest

/** Their quest progress, once they've found the game. */
function QuestCard({ quest }: { quest: SideQuestStanding }) {
  return (
    <section className="pp-quest" aria-labelledby="quest-h">
      <h2 id="quest-h">Side Quest</h2>
      <p className="pp-quest-big">
        <span className="pp-num">{quest.collected}</span>
        <span>of {quest.total}</span>
      </p>
      <QuestList quests={quest.quests} />
      {quest.board.length > 1 && <Board board={quest.board} />}
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
            {q.label}
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


/**
 * The moment of collecting someone: a full-screen splash with the count
 * rising to the new total. A repeat gets a softer, comic sheet instead.
 */
function CollectScreen({ result, onDone, onMine }: { result: CollectResult; onDone: () => void; onMine: () => void }) {
  const s = result.standing;
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [shown, setShown] = useState(result.fresh && !reduced ? Math.max(0, s.collected - 1) : s.collected);
  const done = useRef<HTMLButtonElement>(null);
  // Adults are one quest; everyone else is in their level's quest.
  const questKey = (result.friend.kind ? result.friend.kind === 'adult' : result.friend.levelWord === 'Leader') ? 'leaders' : result.friend.level.toLowerCase();
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

  if (result.leader) {
    return (
      <div className="pp pp-repeat" role="dialog" aria-modal="true" aria-labelledby="repeat-h">
        <div className="pp-sheet">
          <p className="pp-sheet-lead" id="repeat-h">
            Leaders aren’t in the Side Quest
          </p>
          <button ref={done} type="button" className="pp-btn" onClick={onDone}>
            Keep collecting
          </button>
        </div>
      </div>
    );
  }

  if (!result.fresh) {
    return (
      <div className="pp pp-repeat" role="dialog" aria-modal="true" aria-labelledby="repeat-h">
        <div className="pp-sheet">
          <p className="pp-marker" id="repeat-h">
            Bah bahhhh!
          </p>
          <p className="pp-sheet-lead">You’ve already collected {result.friend.firstName}.</p>
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

  const colour = result.friend.levelColour ?? levelColours(result.friend.levelWord).bg;
  return (
    <div className={milestone ? 'pp pp-collect is-milestone' : 'pp pp-collect'} role="dialog" aria-modal="true" aria-labelledby="splash-h">
      <div className="pp-collect-body">
        {/* Their card lands in your collection, with one ring on the water behind it. */}
        <div className="pp-collect-stage" aria-hidden="true">
          <span className="pp-ring" />
          {milestone && <span className="pp-ring pp-ring-2" />}
          <div className="pp-card" style={{ ['--card' as string]: colour, ['--card-fg' as string]: textOn(colour) }}>
            <span className="pp-card-band">{result.friend.levelWord || 'Camp'}</span>
            <span className="pp-card-name">{result.friend.firstName}</span>
            <span className="pp-card-no pp-num">No. {s.collected}</span>
          </div>
        </div>
        <h1 id="splash-h">You collected {result.friend.firstName}</h1>
        <p className="pp-collect-count" aria-live="polite">
          <span className="pp-num">{shown}</span>
          <span>of {s.total}</span>
        </p>
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
