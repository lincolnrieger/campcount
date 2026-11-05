# 08: Build plan

Branch: `rebuild/front-end` from `main`. Build the new UI **alongside** the old one while working, then swap and delete the old one, so the app is never half-broken on `main`.

## What to keep (reuse as-is, or with small typing tweaks)

Keep these non-visual modules. They hold logic that already works and is tested in use:

| Module | Why |
| --- | --- |
| `src/web/api.ts` | The fetch wrapper, `ApiFailure` and error messages |
| `src/web/session.tsx` | Session and principal loading, sign-out, preview |
| `src/web/useApi.ts` | The data loading hook (`data`, `error`, `loading`, `reload`) |
| `src/web/types.ts` | Shared front-end types |
| `src/web/offline/db.ts`, `offline/sync.ts` | The IndexedDB store and the offline scan queue |
| `src/web/scan/decoder.ts`, `useScanSession.ts`, `targets.ts`, `manual.ts` | Camera decoding, scan session state, what's scannable, hand entries |
| `src/web/import/xlsx.ts` | XLSX parsing in the browser |
| `src/web/lanyards/pdf.ts`, `components/LanyardCard.tsx`, `components/QrCode.tsx` | Lanyard and poster PDFs, and the QR rendering. The printed card design can stay. |
| `src/web/confirmDelete.ts` | Its logic (counting scans before delete). Rewire it to use the new ConfirmDialog instead of `window.confirm`. |
| `src/shared/*` | Schemas, permissions, time zones, scan rules, MyScout mapping, names, sections, search |
| Page logic | Reuse the data-handling parts of the current pages (which API calls, what payloads, how results are interpreted). Rewrite all JSX and CSS. |

## What to replace

- `src/web/styles.css` (3,800 lines). Replace it with:
  - `src/web/styles/tokens.css` (from this folder).
  - `src/web/styles/base.css` (reset, `html`/`body`, typography, focus, utilities: under 150 lines).
  - One CSS file per component in `src/web/ui/`, named after the component (for example `Button.css`), imported by the component.

  **Target: under 1,500 lines of CSS in total.**
- All of `src/web/components/` apart from those named above. Rebuild them as `src/web/ui/`.
- All page JSX in `src/web/pages/`. Make new pages under `src/web/screens/`, grouped by area:
  - `screens/events/`
  - `screens/scan/`
  - `screens/event-home/`
  - `screens/people/`
  - `screens/activities/`
  - `screens/meals/`
  - `screens/reports/`
  - `screens/settings/`
  - `screens/admin/`
  - `screens/account/`
  - `screens/public/`
- `shell.ts` and `Layout.tsx`: replace with `ui/AppShell`. Keep a tiny `useTitle` helper.
- `App.tsx` routes: rewrite them to match `03-navigation.md`, including the redirects.

## Phase 1: Foundations (then stop for approval)

1. Add `tokens.css` and `base.css`.
2. Build the components in `06-design-system.md`, and a dev-only `/_components` route showing each one in all its states.
3. Build `AppShell`: the sidebar, the top bar with event tabs, the bottom tab bar and role-aware navigation.
4. Build three screens end to end against the real API:
   - **Event Home**, for an open event, as event manager.
   - **Scanner**, for the gate and a meal, including offline, Find by name and the result states.
   - **Person.**
5. Seed or create a demo camp (Admin › Demo camps) so the screens have realistic data. **Never real data.**
6. Take screenshots at 390px and 1440px of the three screens and the component sheet. Run axe on them.
7. **Stop.** Send the screenshots and a short note to the user, and wait for their OK or changes.

## Phase 2: Every other screen

Build in this order, which follows how often each screen is used:

1. Scan picker.
2. Activity page.
3. Events.
4. People (list, add, edit).
5. Activities (list, add and edit, sign-up kiosk and posters).
6. Meals.
7. Reports.
8. Settings (index, event details, staff, stations, copy).
9. Draft Home checklist.
10. Import.
11. Lanyards and roll sheet.
12. Account and View as.
13. Admin (accounts, log, demo).
14. Public screens:
    - Sign in.
    - Set password.
    - Pair.
    - Kiosk.
    - My activities.
    - Not found.

For each screen:
- Loading skeleton, empty state, error with Try again.
- Busy buttons.
- Toasts.
- Role checks.
- Phone and desktop layouts.

## Phase 3: Swap, clean, verify

1. Point `App.tsx` at the new screens. Delete `src/web/pages/`, the old components and `styles.css`. Remove unused dependencies, if there are any.
2. Update `docs/ui-structure.md` to describe the new structure (replace the old sections).
3. Run all checks: `npx tsc -b && npx eslint . && npx vitest run && npm run build`. The server tests must still pass untouched.
4. Run the UI check script (below) and fix everything it finds.
5. Do the walkthrough in `09-acceptance.md` as every role.
6. Report to the user. Open the PR after they've seen it.

## Tooling to add

- `axe-core` as a devDependency (a test tool, not a UI library).
- `scripts/ui-check.mjs` uses the pre-installed Playwright (`require('playwright')`, `chromium.launch()`). It:
  1. Signs in to the local dev server with a local admin. Create one with `scripts/create-admin.mjs`, following README › Local development, and pass the email and password in as environment variables. Never commit them.
  2. Visits every route at 390×844 and 1440×900.
  3. Saves screenshots to `screenshots/` (git-ignored).
  4. Runs axe and the 44px touch-target check, and fails on violations.
  5. Checks `document.documentElement.scrollWidth <= innerWidth`, so there's no sideways scrolling.
- Run the dev server with `npm run dev -- --port 5173 --strictPort`.

## Rules that still apply

- Never commit real participant data.
- No secrets in front-end code.
- No `localStorage`; ESLint bans it. Use `offline/db.ts` snapshots, or in-memory module state.
- No new UI libraries.
- Commit in small, working steps, with plain-English commit messages.
