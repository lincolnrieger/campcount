# UI rework: event home, reports, settings and links — inventory

The checklist of everything these pages do. Every item must still work after the rework.
Routes, API calls, permission checks and behaviour stay the same; only layout and copy change.

## Event home (`/events/:id/`, `EventHome.tsx`)

- Header: event name; summary with date range, location, Demo badge, status badge when not open.
- Primary "Start scanning" → `/scan?event=:id`, only when `canScan(event)`.
- "Notes for staff" disclosure when the event has a description.
- Draft + `event.configure`: **Get ready** checklist (each step a link, ticked when done):
  - Add staff (`staff.manage`; done when > 1 staff) → `settings/staff`
  - Add people (`roster.edit`; done when any active registration) → `people`
  - Add activities (activities feature + `activities.manage`) → `activities`
  - Add meals (meals feature + `meals.manage`) → `meals`
  - Print lanyards (`credentials.manage`; done when every active person has a code) → `people/lanyards/print`
  - Loading skeleton while the counts load.
  - "Open event" button → confirm → `POST /events/:id/transition {to:'open'}` → toast, reload; error toast.
- Draft without `event.configure`: "This event hasn't opened yet" note.
- Not draft + `reports.view`: **Where everyone is**
  - `GET /whereabouts` (+ `?fresh=n` after a manual mark) and `GET /live`, both polled every 30 s.
  - Site tracked: counts On site / Not arrived / Left camp; each toggles a filter (press again → all).
  - Site not tracked: Expected and At activities now counts.
  - Warning when `openItems > 0` with a link to Reports.
  - Section title follows the filter; "N people · updated HH:MM" live text.
  - Search by name / group (ranked); "Show everyone" clears the filter.
  - Empty state for no matches / no one.
  - Wide: table Name (link to `people/:id`, state from home), Section (Leader for adults), Scout group, Where badge, mark button.
  - Narrow: list rows with the same data.
  - Mark by hand (open + site feature + `site.scan`, person has a site state): Arrived / Left → `recordByHand` → toast; error toast; busy state.
  - Pages of 50 with "Show all N".
  - Loading skeleton, load error with retry.
- Not draft, no `reports.view`: activity leaders get "Open activities"; closed event says scanning has stopped.

## Reports (`/reports`, `Reports.tsx`)

- `GET /reconciliation`, `GET /exports`.
- Loading / load error states.
- Check-up:
  - All clear notice when no items, no pending dietary and no stale phones.
  - Pending dietary reviews warning.
  - One group per context (gate or activity): count still present / scans to check; each item: name, detail, time, badge (Unknown card / To check).
  - `attendance.correct` and status open/completed:
    - Group action "Record departures" (gate) / "Sign everyone out" → reason sheet → `POST /reconciliation/sign-out-all`.
    - Per scan ⋯ "Don't count this scan" → reason sheet → `POST /scans/:id/void`.
  - Reason sheet: prefilled reason, min 3 chars, error, busy, cancel.
  - Scanning phones: last 4 of id, scan count, last upload; "Check it has signal" when no upload for > 1 h.
- Side Quest leaderboard (sideQuest feature): players, collections, top 20 table.
- Downloads: each export with description, dietary warning badge for sensitive ones, Download link to `/api/events/:id/exports/:key.csv`; message when the role can't download; loading/error.
- Close / reopen (`event.close`, open or completed): confirm (mentions items left) → `POST /transition` → toast, reload event.

## Settings index (`/settings`, `SettingsIndex` in `Settings.tsx`)

- Rows, by permission: Event details, Sections, Participant page banner, Lanyards (`event.configure`); Staff with count (`staff.manage`); Scanning stations with count (`stations.manage`); Copy event (not on the camp's own site, platform `platform.events.create`).
- Redirect to event home when nothing to show.
- Event status (`event.close`): current status badge; allowed changes from `EVENT_TRANSITIONS` limited to Cancel event (danger) and Return to draft → confirm → `POST /transition` → toast, reload; error toast.

## Event details (`/settings/event`, `EventDetails`)

- Redirect to Settings without `event.configure`.
- Editable only when draft or open; otherwise a locked notice and the form disabled.
- Fields: name, first day, last day, location, notes for staff, contact email, features (activities, meals, dietary, site, photo, selfSignup, sideQuest).
- Local checks (`checkEventForm`), server field errors, failure message.
- Save → `PATCH /events/:id` with form, features and trimmed contact email → reload, toast, back to Settings. Cancel → Settings.

## Sections (`/settings/sections`, `SectionsSettings.tsx`)

- Redirect without `event.configure`; editable when draft/open.
- Per section: swatch preview (word on colour), name, lanyard word, colour, youth (disabled for Leaders), built-in/added note, people count (`roster.view`).
- Remove for added sections (disabled "In use" when people are in it); Add a section.
- Checks: every name filled, no duplicate names.
- Save → `PATCH /events/:id {sections}` (with `from` for renames) → reload, toast, back. Cancel.

## Participant page banner (`/settings/banner`, `BannerSettings.tsx`)

- Redirect without `event.configure`. `GET /banner`; loading / error.
- Preview or "No banner yet".
- Editable (draft/open): Upload / Replace (png, jpeg, webp; `prepareImage`; `PUT /banner`), busy label; Remove → confirm → `DELETE /banner`. Error notice.

## Staff (`/settings/staff`, `Staff`)

- Redirect without `staff.manage`. `GET /staff`, `GET /me/roles`, activities (if feature).
- Header count; primary Add staff → `add`.
- Loading, error, empty state (with Add staff).
- Each row: name, email, role badge (with activity), "Hasn't set a password" badge.
- ⋯ Change role → sheet with role picker (+ activity select for activity-scoped roles) → `PATCH /staff/:assignmentId` → toast, reload.
- ⋯ Resend invite email (no password yet) → `POST /staff/:id/invite`.
- ⋯ Remove from event → confirm → `DELETE /staff/:id`.

## Add staff (`/settings/staff/add`, `AddStaff`)

- Redirect without `staff.manage`; roles loading / error.
- Segmented: Has an account / Someone new.
- Existing: search accounts (`GET /staff/people`, top 8, ranked), choose, "Choose someone else", "Add someone new" link, error when none picked; loading/error for accounts; empty messages.
- New: name, email (checked), hint that they get an email.
- Role picker (radio + description), activity select for activity-scoped roles.
- Submit → `POST /staff` → toast (created / emailed / email failed) → back to Staff. Cancel link.

## Scanning stations (`/settings/stations`, `Stations.tsx`)

- Not open → notice only.
- `GET /stations`; loading/error; empty state with Set up station.
- Primary Set up station (when list not empty).
- Bulk "Delete finished stations" when more than one finished.
- Each row: name, what it scans, state badge; ⋯ Edit, Reopen (not live), Stop (live, confirm, `DELETE`), Delete (confirm, `POST …/remove`).
- Sheets: set up (name, what it scans, works for hours) → pairing code; edit (name, context; keeps unknown current context); reopen (hours) → pairing code; pairing code sheet with QR, code, host/pair.

## Copy event (`/settings/copy`, `CopyEvent.tsx`)

- On the camp's own site → notice; without platform create permission → notice.
- Name (default "(copy)"), first day (default +364), length text; copy activities / meals checkboxes (only when the feature is on); details always.
- Submit: create event, add me as event manager, copy active activities and meals with shifted times and weekday names, lanyard design with images, photo marker settings; progress text; failure message; navigate to `/camps/:newId`. Cancel.

## Links hub (`/links`, `LinksHub.tsx`)

- Rows by permission: Links for everyone (`activities.manage`), Booking links and Sign-up kiosk & posters (activities + selfSignup + `activities.manage`), Each person's own link (`credentials.manage`). Redirect home when none.

## Links for everyone (`/people/share`, `ShareLinks.tsx`)

- Redirect to Links without `activities.manage`. `GET /participant-links`; loading/error.
- Warning when activity sign-up is off.
- Camp website note when the event has a site: says whether a link is in use there.
- New link form (name, parts) → `POST` → copies the URL → toast; error; cancel. Make disabled with no parts.
- Empty state presets: Everything, Book activities, Programme and food (one click makes the link).
- Each link: name, Camp website badge, Switched off badge; URL, Copy, Open; part toggles (`PATCH features`; can't switch off the last; disabled while busy).
- ⋯ Rename (prompt), Use on / stop using on the camp website (only with a site), Switch on/off, Make a new address (confirm, `POST new-code`), Delete (confirm, `DELETE`).
- Footer note on changes / rate limiting.

## Participant links (`/people/links`, `ParticipantLinks.tsx`)

- `POST /credentials/links` + `GET /registrations` (count without a code); load error with retry; loading.
- Warning: send each link only to that person.
- Missing links notice with "Make N missing links" → `POST /credentials/issue {mode:'missing'}`.
- Search (name, group, code); group filter (when > 1 group).
- Table: name + code, group, link (select on focus), Copy.
- Primary Download CSV (shown count); ⋯ Copy all as text.
- Empty states (no links, no matches).

## View as (`components/ViewAs.tsx`)

Used from Account and Demo camps (admin tools in other areas). Left alone: not one of this area's pages.
