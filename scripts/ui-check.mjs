// UI check: visits every screen at phone and desktop width, saves screenshots,
// and fails on accessibility violations (axe), sideways scrolling, or touch
// targets smaller than 44×44px on phones.
//
// Usage (with `npm run dev -- --port 5173` running, and a local admin account):
//   UI_EMAIL=admin@example.test UI_PASSWORD=… node scripts/ui-check.mjs [page,page…]
// Screenshots go to screenshots/ (git-ignored). Never put real credentials in the repo.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const BASE = process.env.UI_BASE ?? 'http://localhost:5173';
const EMAIL = process.env.UI_EMAIL;
const PASSWORD = process.env.UI_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error('Set UI_EMAIL and UI_PASSWORD for a local admin account.');
  process.exit(2);
}
const only = process.argv[2]?.split(',');
const SIZES = [
  { name: 'phone', width: 390, height: 844, mobile: true },
  { name: 'desktop', width: 1440, height: 900, mobile: false },
];
mkdirSync('screenshots', { recursive: true });

let failures = 0;
const browser = await chromium.launch();
for (const size of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.mobile, hasTouch: size.mobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${BASE}/sign-in`);
  await page.fill('#email', EMAIL);
  if (!(await page.locator('#password').isVisible())) await page.click('form button[type=submit]');
  await page.fill('#password', PASSWORD);
  await page.click('form button:has-text("Sign in")');
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 30000 });

  const get = (path) => page.evaluate(async (p) => (await fetch(`/api${p}`)).json(), path);
  const events = (await get('/events')).events;
  const ev = (events.find((e) => e.isDemo) ?? events[0])?.id;
  if (!ev) throw new Error('No event to check. Create a demo camp first (Admin › Demo camps).');
  const person = (await get(`/events/${ev}/registrations`)).registrations[0]?.id;
  const activity = (await get(`/events/${ev}/activities`)).activities[0]?.id;

  const routes = {
    events: '/',
    newevent: '/events/new',
    scan: `/scan?event=${ev}`,
    gate: `/events/${ev}/scan/site`,
    home: `/events/${ev}`,
    people: `/events/${ev}/people`,
    person: person && `/events/${ev}/people/${person}`,
    personedit: person && `/events/${ev}/people/${person}/edit`,
    addperson: `/events/${ev}/people/add`,
    import: `/events/${ev}/people/import`,
    lanyards: `/events/${ev}/people/lanyards`,
    rollsheet: `/events/${ev}/people/roll-sheet`,
    activities: `/events/${ev}/activities`,
    activity: activity && `/events/${ev}/activities/${activity}`,
    activityedit: activity && `/events/${ev}/activities/${activity}/edit`,
    signupscreen: `/events/${ev}/activities/signup`,
    meals: `/events/${ev}/meals`,
    reports: `/events/${ev}/reports`,
    settings: `/events/${ev}/settings`,
    eventdetails: `/events/${ev}/settings/event`,
    staff: `/events/${ev}/settings/staff`,
    addstaff: `/events/${ev}/settings/staff/add`,
    stations: `/events/${ev}/settings/stations`,
    copy: `/events/${ev}/settings/copy`,
    admin: '/admin',
    accounts: '/admin/accounts',
    log: '/admin/log',
    demo: '/admin/demo',
    account: '/account',
    password: '/account/password',
    viewas: '/account/view-as',
    notfound: '/no-such-page',
  };

  for (const [name, path] of Object.entries(routes)) {
    if (!path || (only && !only.includes(name))) continue;
    await page.goto(`${BASE}${path}`);
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(300);
    const problems = [];

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0) problems.push(`scrolls sideways by ${overflow}px`);

    await page.addScriptTag({ content: AXE });
    const violations = await page.evaluate(async () =>
      (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })).violations.map(
        (v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`,
      ),
    );
    problems.push(...violations);

    if (size.mobile) {
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('a[href], button, input, select, textarea, summary, [role="button"]')]
          .filter((el) => {
            if (el.closest('p, li > span, td')?.matches('p') && el.tagName === 'A') return false; // links inside sentences are exempt
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0 || r.bottom < 0) return false; // hidden, or off screen until focused (skip link)
            if (el.closest('.row-link, tr.row-link')) return false; // the whole row is the link's hit area
            const style = getComputedStyle(el);
            if (style.visibility === 'hidden' || (el.type === 'radio' && el.closest('.segmented'))) return false;
            if ((el.type === 'checkbox' || el.type === 'radio') && el.closest('label')) {
              const l = el.closest('label').getBoundingClientRect();
              return l.height < 44;
            }
            return r.height < 44 || r.width < 44;
          })
          .slice(0, 5)
          .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}"`),
      );
      if (small.length) problems.push(`touch targets under 44px: ${small.join(', ')}`);
    }

    await page.screenshot({ path: `screenshots/${size.width}-${name}.png`, fullPage: true });
    if (problems.length) failures += problems.length;
    console.log(`${size.name.padEnd(8)} ${name.padEnd(13)} ${problems.length ? `FAIL\n    ${problems.join('\n    ')}` : 'ok'}`);
  }
  if (errors.length) {
    failures += errors.length;
    console.log(`${size.name}: page errors:\n    ${errors.join('\n    ')}`);
  }
  await ctx.close();
}
await browser.close();
console.log(failures ? `\n${failures} problem(s).` : '\nAll clear.');
process.exit(failures ? 1 : 0);
