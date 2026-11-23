# UI rework: platform and account pages — inventory

The checklist of everything these pages do before the rework. Every item must still work afterwards.
`[x]` = checked in the browser after the rework. `[~]` = checked in code only (needs a non-admin account on several camps, or a camp's own address).

## Camps console (`/`, `Camps` in `Camps.tsx`) — shown to users with any platform permission
- [x] Loads `GET /events`; skeleton while loading; LoadError with Try again on failure.
- [x] Create camp button (primary), only with `platform.events.create`; goes to `/camps/new`.
- [x] Empty state "No camps yet" with Create camp (permission-gated).
- [x] Camps split into Current and upcoming (open, draft) and Past (completed, archived, cancelled).
- [x] Wide: table with logo/letter mark, name link to `/camps/:id`, address (`sub.rootDomain` or "Not set"), dates, status badge, Demo badge.
- [x] Narrow: list rows with mark, name link, address · dates, status badge.

## Camp page (`/camps/:campId`, `CampPage`)
- [x] Loads `GET /events/:id`; skeleton; LoadError with back link.
- [x] Header: back to Camps, name, address, dates, status badge.
- [x] Primary: "Open camp site" (external link to the camp's address) or "Open camp" (`/events/:id`) when no address.
- [x] Branding form: Camp name, Address (lowercased, invalid characters stripped, `.rootDomain` suffix), Colour (picker + hex text, accessible-darkened sample, hint when adjusted), Logo (PNG/JPEG/WebP ≤ 300 KB checks, preview, Remove logo).
- [x] Client checks (name, subdomain rules, hex colour) with ErrorSummary; server field errors.
- [x] Warning when the address changes from the saved one (breaks old links).
- [x] Save: `PATCH /events/:id`, then logo `PUT`/`DELETE /events/:id/logo`; toast "Changes saved"; reload.
- [x] Next steps links: Add staff (`settings/staff`), Add people (`people`), Event details and features (`settings/event`) — on the camp's site when it has an address, else `/events/:id/...`; note that they open on the camp's site.
- [x] Delete camp (only `platform.events.oversee`): confirm with type DELETE, `DELETE /admin/events/:id`, toast, back to `/`.

## Create camp (`/camps/new`, `NewCamp`)
- [x] Branding fields as above; address suggested from the name until edited.
- [x] First day / Last day (last ≥ first, min), Location (optional).
- [x] Feature checklist (`FeatureChecklist`, shared with Settings).
- [x] ErrorSummary; `POST /events`; logo upload (toast on logo failure); toast; navigate to the camp page. Cancel back to `/`.

## Events (`Events` in `Events.tsx`, used by StaffLanding fallback) and Create event (`/events/new`)
- [~] Events list: first visit lands someone with one event and no platform permissions straight in it (`landingFor`).
- [~] Search (when > 8 events) by name or location; no-match empty state.
- [~] Happening now (open), Coming up (draft), Past (on request: "Show past events (n)", or when searching); "No current events".
- [~] Rows: name link, dates · location, Demo badge, status badge.
- [x] Empty state, with Create event when allowed (`platform.events.create`).
- [x] Create event page: permission check message; EventFields (name, dates, location, notes) + FeatureChecklist; `POST /events`; toast; navigate; Cancel. `EventFields`, `FeatureChecklist`, `checkEventForm` are also used by Settings (unchanged API).

## Admin index (`/admin`, `AdminIndex`)
- [x] Redirects to `/` without `platform.users.manage`.
- [x] Links to Accounts, Activity log, Demo camps.
- [x] `useAdminOnly` helper export kept.

## Accounts (`/admin/accounts`, `AdminUsers`)
- [x] Loads `GET /admin/users`; skeleton; LoadError; empty / no-match states.
- [x] Summary: count and number of admins.
- [x] Add account (primary) → sheet: Name, Email, Admin checkbox, Email them a set-up link checkbox; checks; `POST /admin/users`; toast; then the password link sheet.
- [x] Search name or email; filter All / Admins / No password yet / Disabled / Demo; "n of m" count.
- [x] Sortable table (Name, Email, Events, Last active) on wide; list on narrow.
- [x] Badges: Admin, Demo, No password, Not confirmed, Disabled; "(you)"; disabled rows muted.
- [x] Row menu: Rename (sheet, `PATCH displayName`); Copy set-up / password reset link (`POST /admin/users/:id/password-link`, not for demo/disabled); Make / Remove admin (not self); Disable (confirm) / Enable (not self); Delete account… (confirm, `DELETE`, anonymised message) (not self).
- [x] Password link sheet: link, expiry, Copy link, Share… (when supported), Email them instead (`sendEmail: true`).
- [x] Note: staff are added from the camp.

## Activity log (`/admin/log`, `AdminLog`)
- [x] Camp select (from `GET /events`), kind Everything / Scans / Changes, search (debounced 300 ms) → `GET /admin/log?kind&eventId&q`.
- [x] Grouped by day (Adelaide time), time per entry.
- [x] Scan sentences with person link to `/events/:eid/people/:rid`, place, scanned by, method, note, camp name (when all camps), outcome badge (repeat, to check, refused, undone) and muted row.
- [x] Change sentences: actor, plain-English action, target, detail.
- [x] Loading skeleton, error notice with Try again, empty state (with query), Load more (`before`).

## Demo camps (`/admin/demo`, `AdminDemo`)
- [x] Loads `GET /admin/demo`; skeleton; LoadError; empty state.
- [x] Size select (20/80/200/400) + Create demo camp (`POST /admin/demo`), toast, reload.
- [x] Rows: name link to `/camps/:id`, people count, demo account count.
- [x] View as a role → ViewAsSheet with that camp.
- [x] ⋯ Delete demo camp… (confirm, `DELETE /admin/demo/:id`).

## Account (`/account`, `/account/password`, `/account/view-as`)
- [x] Name form (`PATCH /me`, min 2 chars, disabled when unchanged), email read-only.
- [x] Change / Set a password link (not for demo users), "Not set" badge.
- [x] View as a role link (admins, while previewing, or `canViewAs`), "Viewing" badge.
- [x] Sign out.
- [x] Delete my account (not demo): password field when the user has one, confirm with DELETE, `DELETE /me`, then `/sign-in`; error notice.
- [x] Set password page: first-sign-in mode (`?first=1`, Skip for now), current password when one is set, new password (≥ 10), Show password, `POST /auth/password`, toast, navigate.
- [x] View as page: ViewAsForm for admins/previewing, else notice.

## Staff landing (`StaffLanding`)
- [~] One camp with an address: redirect to it. Several: list with marks and addresses. None with addresses but events: `Events`. None: empty state.

## More (`/more`, event sites on phones)
- [~] Sections beyond the tab bar, plus Account; Sign out. (File unchanged.)

## Not found
- [x] Message and a button to the camp home (in an event) or the start.

## Scan hub (`/scan`, `ScanHub`)
- [x] Events the user can scan; event picker when more than one (`?event=`, remembered).
- [x] Empty state when nothing to scan.
- [x] `ScanTargetPicker` (also used in the scanner's Switch sheet): On now, Gate, day tabs, Meals, Activities; auto-open when only one thing (scan-only users); offline note.
