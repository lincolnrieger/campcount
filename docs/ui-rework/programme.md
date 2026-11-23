# UI rework inventory: Programme

Checklist of every feature on the Programme pages before the rework. Each item must still work afterwards.
Permissions: `activities.manage`, `meals.manage`, `reports.view`, `event.configure`, `activity.bookings`, `site.scan`; event status (draft/open/closed/completed); features (`activities`, `meals`, `selfSignup`).

## Activities (`/activities`, `Activities.tsx`)
- [ ] Loads `GET /events/:id/activities`; live counts from `GET /events/:id/live` only with `reports.view` and event not draft.
- [ ] Loading skeleton; load error with Try again.
- [ ] Header "Activities"; non-managers see "The activities you run".
- [ ] "Add activity" (primary) only for `activities.manage` and event draft/open → `activities/new`.
- [ ] Hides programme items (`kind: program`); managers don't see team events (they're on Teams); non-managers only see active ones.
- [ ] Empty state: managers "No activities yet" + Add activity; leaders "No activities for you yet".
- [ ] Day tabs: each day used, plus "No time set" when some have no time / a time outside the camp; defaults to today if used, else first; today labelled "Today, …".
- [ ] Search by name or place (shown when > 15 activities or while searching); searching ignores the day and shows the day in each row.
- [ ] Rows sorted by start then name: start/end time (or "Any time"), name links to the activity page, place, live count ("N here now" / "N checked in").
- [ ] Cancelled rows muted with a Cancelled badge.
- [ ] Nothing on this day / no search match empty states, Clear search.

## Activity page (`/activities/:id`, `ActivityRoster.tsx`)
- [ ] Loads `GET …/attendance`, polls every 20 s.
- [ ] Load error: 403/404 message "deleted, or you don't run it"; Try again.
- [ ] Header: name, back (Teams for team events when manager, else Activities), when (day + time range or "Runs all camp"), place, Cancelled badge.
- [ ] Scan button (primary) when `canCheckIn`, event open and activity active → `/events/:id/scan/activity/:aid`.
- [ ] ⋯ menu, team event: Teams, Edit settings (manager), Print this list.
- [ ] ⋯ menu, manager: Edit activity, Add another session (`new?from=`), Print, Cancel activity (confirm, undo toast) / Restore activity, Delete activity… (deleteContext confirm, navigates back).
- [ ] ⋯ menu, others: Print this list.
- [ ] Cancelled warning; leader instructions shown (pre-line).
- [ ] Counts: booked (x/capacity), here now / checked in, to come.
- [ ] Capacity line: Full / N places left; block vs warn explanation.
- [ ] Show filter: To come (n) / Here (n) / All; starts on All when nobody booked.
- [ ] "Add someone" when canCheckIn or canBook; opens the add sheet; `?add=1` opens it on load.
- [ ] Search this list (when > 12 people).
- [ ] Rows: name, section · group · swimming, status badge (Here since / Left / Signed in / To come), No photos badge.
- [ ] Check in / Sign out button (canCheckIn and not done); undo on check-in toast (reset).
- [ ] Row ⋯: Move back to To come / Undo check-in (canCheckIn, visits>0, open); Move to another activity… (canMove, booked, not completed); Remove booking (canBook, booked, not present; undo).
- [ ] Empty states per filter / search.
- [ ] Add sheet: search everyone not involved (top 12), Add to come (canBook), Check in (canScan).
- [ ] Move sheet: search, other sessions of same activity first, then others; booked/capacity; Move here; error notice; loading/error.
- [ ] Print: row actions hidden.

## Add / edit activity (`/activities/new`, `/activities/new?from=`, `/activities/:id/edit`, `ActivityEdit.tsx`)
- [ ] Only managers while draft/open; else warning.
- [ ] Loading, load error, deleted source.
- [ ] Modes: new, copy ("Add another session": same settings, starts when source ends, same length), edit.
- [ ] Fields: Name (required), Day (or no set time), Start/End (end optional, start change keeps length), Place, Instructions for leaders.
- [ ] Options: Capacity (digits), Refuse sign-ins when full (only with capacity), Sign out as well as in, Allow repeat visits, Open for self sign-up + Booking required (only when `selfSignup` feature on). Options section opens when the activity already uses one.
- [ ] Validation: name, end after start; error summary; server field errors.
- [ ] Save → PATCH/POST, toast, navigate to the activity; Cancel → back.

## Import programme (`/activities/import`, `ProgramImport.tsx`)
- [ ] Only `activities.manage`; loads existing activities (+ meals if meals feature and `meals.manage`).
- [ ] Stepper: Choose file → Match columns → Check → Done.
- [ ] File: .xlsx/.csv/.tsv/.txt; reading state; error for empty file; template download (CSV data URL); format help.
- [ ] Map: one select per field (auto-mapped), sample value, "Not in this file"; meals-by-name option (when no Type column and meals allowed); name required warning; Next / Back.
- [ ] Check: counts (activities and programme, meals, problems); skip duplicates toggle (when any); meals skipped note; problems note; table (line, name + type/booking badges, when, place, result + notes); Import N sessions (disabled at 0) / Back.
- [ ] Import: `POST /program/import`; booking required → signupOpen; toast; Done step with links to Schedule and Activities.
- [ ] Error notice.

## Schedule (`/schedule`, `Schedule.tsx`)
- [ ] Loads activities (activities feature + manage) and meals (meals feature + manage); loading / error.
- [ ] Header summary "N sessions across N days"; Import programme (primary, managers); ⋯ Add activity, Print schedule.
- [ ] Read-only message when event not draft/open; usage hint.
- [ ] Desktop: all days side by side; phone: day tabs (today first).
- [ ] Empty state with Import programme / Add activity.
- [ ] "No set time" tray: chips, drag onto grid (desktop), tap to open.
- [ ] Grid: hours axis (7am–9pm or wider), today highlighted, overlapping sessions side by side, colours by kind, cancelled dashed, short sessions compact.
- [ ] Drag to move (mouse/pen; across days), drag bottom edge to resize, snaps to 15 min, toast with Undo; click after drag swallowed.
- [ ] Click empty space → Add a session sheet (activity/meal choice when both, name, day, start, end, place).
- [ ] Session sheet: kind/booking/cancelled badges, place, booked; set day/time (or no set time) with validation; Open activity; Edit details; Duplicate (after itself); Cancel/Restore (undo); Delete… ; "All meals" link for meals.
- [ ] Key (legend); print layout.

## Teams (`/teams`, `/teams/:id`, `Teams.tsx`)
- [ ] List: loads `/team-events`; loading/error; empty state; Add team event (managers, draft/open) in a sheet → navigates to it.
- [ ] Rows: name link, when · place · size rule, teams (of max) · people · short of players, Cancelled / Registration open/closed badge.
- [ ] Team event page: back (Teams for managers, else Check-ins); loading/error/deleted.
- [ ] Header summary: when, place, size rule, max teams; Add team (draft/open; disabled when max teams reached).
- [ ] ⋯: Check-ins, Edit settings (manager, editable), Delete team event… (confirm).
- [ ] Registration open/closed strip with counts; Open/Close registration (manager, editable).
- [ ] Empty "No teams yet".
- [ ] Team cards: name, count (n/max), Locked + code badge, Ready / Needs N more / Full; ⋯ Add person (not full), Rename team, Delete team… (confirm).
- [ ] Members: name, section · group, Remove (editable).
- [ ] Add person button (editable, not full) → picker sheet (search, "On a team" badge, move confirm).
- [ ] Team event form: name, day/time, place, fewest/most per team, most teams, notes, registration open; validation; error summary.
- [ ] Team name form (add/rename) with validation.

## Meals (`/meals`, `Meals.tsx`, `MealItemsPanel.tsx`)
- [ ] Loads meals, meal items, live (reports.view, not draft); loading/error.
- [ ] Header summary "N meals"; Add a day of meals (primary, `meals.manage` + draft/open); ⋯ Add a single meal, Import meals (JSON).
- [ ] Empty state with Add a day of meals.
- [ ] Day tabs incl. "No day set"; default today / first used day; day inferred from name when no time.
- [ ] Expand all / Collapse all.
- [ ] Meal card: chevron + name toggle open, time, place, served (n of expected), "Give it a day…" hint, menu text, items summary (items, alternatives, contains), cancelled.
- [ ] Meal ⋯: Edit meal, Duplicate to another day…, Cancel (undo) / Restore, Delete meal… (deleteContext).
- [ ] Add a day sheet: day; adds missing breakfast/lunch/dinner; skip message; error.
- [ ] Meal form (add/edit): name, day, starts (required), ends, place, menu, additional notes; validation; server errors.
- [ ] Duplicate sheet: day (suggests name), name; error.
- [ ] Import JSON sheet: file or paste, mode replace/add, Check (preview plan: errors, meals with New/Replaces), Import N meals, Cancel; errors.
- [ ] Items panel: Add item, Copy items from another meal (managers); Served to everyone / Dietary alternatives sections, by category (collapsible; open when ≤ 12 items); item row: grip drag to reorder (within category), name toggles details (ingredients, staff notes), chips (TBC, contains, may contain, dietary); alternative line (replaces / for); item ⋯ Edit, Duplicate, Move up/down, Delete… (confirm); meal additional notes.
- [ ] Item form: name, category, ingredients status, ingredients list, contains / may contain / suitable for pickers (+ custom), dietary alternative (replaces, who it's for), staff notes.
- [ ] Copy items sheet: from meal (with counts), pick items (All / None), Copy N items; empty message.

## Sign-up kiosk (`/activities/signup`, `SignupScreen.tsx`)
- [ ] Only `activities.manage`; loading/error.
- [ ] Sign-up off: empty state; Turn on activity sign-up (`event.configure`) → PATCH features, reload.
- [ ] Kiosk: QR, link field (select on focus), Open kiosk (new tab), Copy link.
- [ ] ⋯ Make a new link… (danger confirm) → `/signup/new-link`.
- [ ] Session posters: list with when · place, places left badge, Print one; Print all (> 1); empty state with link to Activities.
- [ ] Print renders posters only (QR with `?activity=`).

## Booking links (`/activities/links`, `BookingLinks.tsx`)
- [ ] Loads `/signup/links`; loading/error; back to Links.
- [ ] Warning when self sign-up off.
- [ ] Empty state.
- [ ] Download all links (CSV); Make new links (danger confirm) → `/signup/links/new`.
- [ ] Rows: name, when · place, link, Copy.
