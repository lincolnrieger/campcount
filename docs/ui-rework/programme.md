# UI rework inventory: Programme

Checklist of every feature on the Programme pages before the rework. Each item must still work afterwards.
Permissions: `activities.manage`, `meals.manage`, `reports.view`, `event.configure`, `activity.bookings`, `site.scan`; event status (draft/open/closed/completed); features (`activities`, `meals`, `selfSignup`).

## Activities (`/activities`, `Activities.tsx`)
- [x] Loads `GET /events/:id/activities`; live counts from `GET /events/:id/live` only with `reports.view` and event not draft.
- [x] Loading skeleton; load error with Try again.
- [x] Header "Activities"; non-managers see "The activities you run".
- [x] "Add activity" (primary) only for `activities.manage` and event draft/open → `activities/new`.
- [x] Hides programme items (`kind: program`); managers don't see team events (they're on Teams); non-managers only see active ones.
- [x] Empty state: managers "No activities yet" + Add activity; leaders "No activities for you yet".
- [x] Day tabs: each day used, plus "No time set" when some have no time / a time outside the camp; defaults to today if used, else first; today labelled "Today, …".
- [x] Search by name or place (shown when > 15 activities or while searching); searching ignores the day and shows the day in each row.
- [x] Rows sorted by start then name: start/end time (or "Any time"), name links to the activity page, place, live count ("N here now" / "N checked in").
- [x] Cancelled rows muted with a Cancelled badge.
- [x] Nothing on this day / no search match empty states, Clear search.

## Activity page (`/activities/:id`, `ActivityRoster.tsx`)
- [x] Loads `GET …/attendance`, polls every 20 s.
- [x] Load error: 403/404 message "deleted, or you don't run it"; Try again.
- [x] Header: name, back (Teams for team events when manager, else Activities), when (day + time range or "Runs all camp"), place, Cancelled badge.
- [x] Scan button (primary) when `canCheckIn`, event open and activity active → `/events/:id/scan/activity/:aid`.
- [x] ⋯ menu, team event: Teams, Edit settings (manager), Print this list.
- [x] ⋯ menu, manager: Edit activity, Add another session (`new?from=`), Print, Cancel activity (confirm, undo toast) / Restore activity, Delete activity… (deleteContext confirm, navigates back).
- [x] ⋯ menu, others: Print this list.
- [x] Cancelled warning; leader instructions shown (pre-line).
- [x] Counts: booked (x/capacity), here now / checked in, to come.
- [x] Capacity line: Full / N places left; block vs warn explanation.
- [x] Show filter: To come (n) / Here (n) / All; starts on All when nobody booked.
- [x] "Add someone" when canCheckIn or canBook; opens the add sheet; `?add=1` opens it on load.
- [x] Search this list (when > 12 people).
- [x] Rows: name, level · group · swimming, status badge (Here since / Left / Signed in / To come), No photos badge.
- [x] Check in / Sign out button (canCheckIn and not done); undo on check-in toast (reset).
- [x] Row ⋯: Move back to To come / Undo check-in (canCheckIn, visits>0, open); Move to another activity… (canMove, booked, not completed); Remove booking (canBook, booked, not present; undo).
- [x] Empty states per filter / search.
- [x] Add sheet: search everyone not involved (top 12), Add to come (canBook), Check in (canScan).
- [x] Move sheet: search, other sessions of same activity first, then others; booked/capacity; Move here; error notice; loading/error.
- [x] Print: row actions hidden.

## Add / edit activity (`/activities/new`, `/activities/new?from=`, `/activities/:id/edit`, `ActivityEdit.tsx`)
- [x] Only managers while draft/open; else warning.
- [x] Loading, load error, deleted source.
- [x] Modes: new, copy ("Add another session": same settings, starts when source ends, same length), edit.
- [x] Fields: Name (required), Day (or no set time), Start/End (end optional, start change keeps length), Place, Instructions for leaders.
- [x] Options: Capacity (digits), Refuse sign-ins when full (only with capacity), Sign out as well as in, Allow repeat visits, Open for self sign-up + Booking required (only when `selfSignup` feature on). Options level opens when the activity already uses one.
- [x] Validation: name, end after start; error summary; server field errors.
- [x] Save → PATCH/POST, toast, navigate to the activity; Cancel → back.

## Import programme (`/activities/import`, `ProgramImport.tsx`)
- [x] Only `activities.manage`; loads existing activities (+ meals if meals feature and `meals.manage`).
- [x] Stepper: Choose file → Match columns → Check → Done.
- [x] File: .xlsx/.csv/.tsv/.txt; reading state; error for empty file; template download (CSV data URL); format help.
- [x] Map: one select per field (auto-mapped), sample value, "Not in this file"; meals-by-name option (when no Type column and meals allowed); name required warning; Next / Back.
- [x] Check: counts (activities and programme, meals, problems); skip duplicates toggle (when any); meals skipped note; problems note; table (line, name + type/booking badges, when, place, result + notes); Import N sessions (disabled at 0) / Back.
- [x] Import: `POST /program/import`; booking required → signupOpen; toast; Done step with links to Schedule and Activities.
- [x] Error notice.

## Schedule (`/schedule`, `Schedule.tsx`)
- [x] Loads activities (activities feature + manage) and meals (meals feature + manage); loading / error.
- [x] Header summary "N sessions across N days"; Import programme (primary, managers); ⋯ Add activity, Print schedule.
- [x] Read-only message when event not draft/open; usage hint.
- [x] Desktop: all days side by side; phone: day tabs (today first).
- [x] Empty state with Import programme / Add activity.
- [x] "No set time" tray: chips, drag onto grid (desktop), tap to open.
- [x] Grid: hours axis (7am–9pm or wider), today highlighted, overlapping sessions side by side, colours by kind, cancelled dashed, short sessions compact.
- [x] Drag to move (mouse/pen; across days), drag bottom edge to resize, snaps to 15 min, toast with Undo; click after drag swallowed.
- [x] Click empty space → Add a session sheet (activity/meal choice when both, name, day, start, end, place).
- [x] Session sheet: kind/booking/cancelled badges, place, booked; set day/time (or no set time) with validation; Open activity; Edit details; Duplicate (after itself); Cancel/Restore (undo); Delete… ; "All meals" link for meals.
- [x] Key (legend); print layout.

## Teams (`/teams`, `/teams/:id`, `Teams.tsx`)
- [x] List: loads `/team-events`; loading/error; empty state; Add team event (managers, draft/open) in a sheet → navigates to it.
- [x] Rows: name link, when · place · size rule, teams (of max) · people · short of players, Cancelled / Registration open/closed badge.
- [x] Team event page: back (Teams for managers, else Check-ins); loading/error/deleted.
- [x] Header summary: when, place, size rule, max teams; Add team (draft/open; disabled when max teams reached).
- [x] ⋯: Check-ins, Edit settings (manager, editable), Delete team event… (confirm).
- [x] Registration open/closed strip with counts; Open/Close registration (manager, editable).
- [x] Empty "No teams yet".
- [x] Team cards: name, count (n/max), Locked + code badge, Ready / Needs N more / Full; ⋯ Add person (not full), Rename team, Delete team… (confirm).
- [x] Members: name, level · group, Remove (editable).
- [x] Add person button (editable, not full) → picker sheet (search, "On a team" badge, move confirm).
- [x] Team event form: name, day/time, place, fewest/most per team, most teams, notes, registration open; validation; error summary.
- [x] Team name form (add/rename) with validation.

## Meals (`/meals`, `Meals.tsx`, `MealItemsPanel.tsx`)
- [x] Loads meals, meal items, live (reports.view, not draft); loading/error.
- [x] Header summary "N meals"; Add a day of meals (primary, `meals.manage` + draft/open); ⋯ Add a single meal, Import meals (JSON).
- [x] Empty state with Add a day of meals.
- [x] Day tabs incl. "No day set"; default today / first used day; day inferred from name when no time.
- [x] Expand all / Collapse all.
- [x] Meal card: chevron + name toggle open, time, place, served (n of expected), "Give it a day…" hint, menu text, items summary (items, alternatives, contains), cancelled.
- [x] Meal ⋯: Edit meal, Duplicate to another day…, Cancel (undo) / Restore, Delete meal… (deleteContext).
- [x] Add a day sheet: day; adds missing breakfast/lunch/dinner; skip message; error.
- [x] Meal form (add/edit): name, day, starts (required), ends, place, menu, additional notes; validation; server errors.
- [x] Duplicate sheet: day (suggests name), name; error.
- [x] Import JSON sheet: file or paste, mode replace/add, Check (preview plan: errors, meals with New/Replaces), Import N meals, Cancel; errors.
- [x] Items panel: Add item, Copy items from another meal (managers); Served to everyone / Dietary alternatives levels, by category (collapsible; open when ≤ 12 items); item row: grip drag to reorder (within category), name toggles details (ingredients, staff notes), chips (TBC, contains, may contain, dietary); alternative line (replaces / for); item ⋯ Edit, Duplicate, Move up/down, Delete… (confirm); meal additional notes.
- [x] Item form: name, category, ingredients status, ingredients list, contains / may contain / suitable for pickers (+ custom), dietary alternative (replaces, who it's for), staff notes.
- [x] Copy items sheet: from meal (with counts), pick items (All / None), Copy N items; empty message.

## Sign-up kiosk (`/activities/signup`, `SignupScreen.tsx`)
- [x] Only `activities.manage`; loading/error.
- [x] Sign-up off: empty state; Turn on activity sign-up (`event.configure`) → PATCH features, reload.
- [x] Kiosk: QR, link field (select on focus), Open kiosk (new tab), Copy link.
- [x] ⋯ Make a new link… (danger confirm) → `/signup/new-link`.
- [x] Session posters: list with when · place, places left badge, Print one; Print all (> 1); empty state with link to Activities.
- [x] Print renders posters only (QR with `?activity=`).

## Booking links (`/activities/links`, `BookingLinks.tsx`)
- [x] Loads `/signup/links`; loading/error; back to Links.
- [x] Warning when self sign-up off.
- [x] Empty state.
- [x] Download all links (CSV); Make new links (danger confirm) → `/signup/links/new`.
- [x] Rows: name, when · place, link, Copy.

## Notes from the check
- Checked in Chromium at 1280x900 and 390x844 against the local demo camp (activities imported from a CSV, team events, meals and items made through the UI).
- Not exercised in the browser (code paths kept as they were): a non-manager leader, a closed or completed event, and the kiosk page with sign-up off.
- Server behaviour, unchanged: once an activity is cancelled its page (attendance) returns 404, so the cancelled banner on the activity page only shows if that changes. Undo on the cancel toast works.
