# UI rework: People — inventory

Everything below must still work after the rework. Ticked when checked in the
browser (desktop 1280×900 and iPhone 13) after the rework.

## People › Everyone (`Roster.tsx`, `/people`)

- [x] Loads `GET /events/:id/registrations`; skeleton rows while loading; LoadError with Try again on failure.
- [x] Header: title "People"; summary of active count, youth and leaders.
- [x] "Add person" primary button → `people/add` (needs `roster.edit`).
- [x] Notice: N people without a lanyard, link to `lanyards/print` (needs `credentials.manage`, only when > 0 active people have no code).
- [x] Empty event: EmptyState with "Import from the registration spreadsheet" (→ `import`, needs `roster.import`) and "Add person" (needs `roster.edit`).
- [x] Search by name, preferred/first name, participant ID, lanyard code, group.
- [x] Filter: Everyone (active), Youth, Leaders, No lanyard, Withdrawn (withdrawn list shows only withdrawn).
- [x] Count of people shown (live region).
- [x] Sort by Name (last name then first), Section/role, group, Lanyard; toggle direction (wide table).
- [x] Wide (≥1024px): table, name links to the person page; columns Name, Level (role for adults), group, Lanyard code, Status badges.
- [x] Narrow: list rows with name link, meta "role · group", badges; withdrawn rows muted.
- [x] Badges: Withdrawn, No photos (photo feature on and consent no), Allergy, No lanyard (active only).
- [x] No matches: EmptyState with "Clear search and filter".
- [x] Bulk delete (needs `roster.edit`, people exist): enter select mode from ⋯ menu "Select people to delete…"; checkboxes per row; select all shown; count; "Delete selected" (disabled at 0) with danger confirm (single vs many wording); deletes one by one via `DELETE /registrations/:id`; toast success, partial failure toast "Deleted x of n."; reload; Cancel leaves select mode and clears.

## People › Add person (`AddPerson.tsx`, `/people/add`)

- [x] Back link to People. Title "Add person".
- [x] `PersonFields` form (youth levels, photo question if feature on, dietary if feature on, youth/leader labels).
- [x] Local validation: first name, last name, participant ID unless "Not a Seniors member"; ErrorSummary linking to fields.
- [x] Server field errors shown; failure message in summary; no-connection message.
- [x] Submit `POST /registrations`; toast "Added …"; navigate to the person page (or People) with replace.
- [x] Busy state "Adding…"; Cancel → People.

## Person page (`Person.tsx` › `Person`, `/people/:id`)

- [x] Loads `GET /registrations/:id`; skeleton; LoadError (404 → "This person is no longer on the event.").
- [x] Back link: Home when opened from home (location state `from: 'home'`), otherwise People.
- [x] Header: full name; summary level · position (adults) · group; badges Withdrawn, No photos, Allergy.
- [x] Primary "Mark as arrived" / "Mark as left" (event open, site feature, `site.scan`, where.site known, active) → manual site scan; toast or error toast; reload.
- [x] ⋯ menu: Edit details (→ `edit`, can.edit); Download lanyard (can.cards, has code → PDF of the camp design, both sides); Issue lanyard (can.cards, active, no code); Replace lanyard (confirm); Withdraw from event (confirm; toast with Undo) / Restore to event; Delete person… (danger confirm mentions scan count; navigates to People).
- [x] Right now panel: on site since / left at / not arrived; activities currently at; last scanned line.
- [x] Dietary needs (when `dietary` present): list with Allergy badge; "None recorded."; Edit button (can.editDietary) opens Sheet with DietaryEditor; Save (`PUT …/dietary`), toast, reload; Cancel.
- [x] Activities: bookings with day, time range or "Any time", "booked by leaders"; empty text.
- [x] Lanyard panel: level colour word, level name, QR (can.cards and code; loaded via `credentials/print` view), loading / failed text, short code; "No lanyard issued yet."
- [x] History grouped by day, newest first: time, verb · place, by whom, method, outcome badge; void struck; ⋯ "Undo this scan" (needs `attendance.correct`, not void/rejected) with confirm → `POST /scans/:id/void`.
- [x] Details list: name (+ goes by), participant ID or "Not a member", level, role (adult), car rego (adult), group, team, extra import fields, photos, lanyard code (can.cards).

## Edit details (`Person.tsx` › `PersonEdit`, `/people/:id/edit`)

- [x] Loads person; skeleton; LoadError. Back link to the person.
- [x] Fields: first, last (required), goes by, participant ID, level (select incl. current unknown level; hint says youth/adult), group, Role (adult levels only), Car rego (adult kind), Photos (when consent field exists), extra import fields (clear to remove).
- [x] Only changed fields sent via PATCH; field errors; failure message; Saving… busy; toast "Changes saved" and back to person; Cancel.

## Leader roster (`LeaderRoster.tsx`, `/people/leader-roster`)

- [x] Loads `GET /duties`; skeleton; LoadError; EmptyState "No duties yet" with Add duty.
- [x] "Add duty" primary (needs `roster.edit` and event draft/open).
- [x] View toggle: By duty / By leader.
- [x] By duty: grouped by day; each duty card with time range · location, notes, people list, Remove per person (editable), Add leader button, ⋯ menu Add leader / Edit duty / Delete duty… (confirm).
- [x] By leader: each leader with their duties (day, time, title, location), Clash badge on overlaps; empty text.
- [x] Duty sheet: title (required), day (event days), start, end (optional, must be after start), where, notes; ErrorSummary; failure Notice; create (POST) or edit (PATCH); toast; reload.
- [x] Leader picker sheet: search (autofocus); leaders by default, search finds anyone (top 40 ranked); "On this duty" (disabled), "Busy then" (overlapping duty), "Adding…"; stays open to add several; empty texts.

## Roll sheet (`RollSheet.tsx`, `/people/roll-sheet`)

- [x] Loads registrations; skeleton; LoadError.
- [x] Print button (window.print) once loaded.
- [x] Heading (optional), tick columns (comma separated, max 6), Who: Everyone / Youth only / Leaders only.
- [x] Printed sheet: title, camp name, printed date, privacy line; table Name, group, tick columns; active people only, sorted by group then last name. Controls hidden in print.

## Import with column matching (`Import.tsx`, `/people/import/columns`)

- [x] Loads `GET /import/context`; skeleton; LoadError.
- [x] Source: the registration spreadsheet or the consent export ; title follows the source; the consent export summary.
- [x] Stepper: the registration spreadsheet file → match → check → dietary → done; the consent export skips match.
- [x] Error Notice for failures.
- [x] File step: source choice with descriptions, privacy note, file input (accept by source), "Reading…".
- [x] Map step: file name, rows and column counts; each target field with select (Not in this file), sample of the first row, optional marks; other columns to keep (up to MAX_EXTRA_FIELDS, sensitive columns hidden with count); dietary column warning (needs review / switched off); missing required warning; Next disabled when missing; Back.
- [x] Check step (before plan): N ready; the consent export tabs list with skipped reasons; problems (first 8, download CSV); Next (preview) busy "Checking…", disabled with no valid rows; Back.
- [x] Check step (plan): counts New / Changed / No change / Dietary to review; problems; "Mark people not in this file as withdrawn" (the registration spreadsheet only, re-previews, shows count); "See what changed" list; Next to dietary (when reviewing and pending) or Import N people (commit); Back.
- [x] Dietary step: explanation; NothingToRecord panel (ticked list, untick, mark N as no dietary needs, done + Undo); review items with name, group, member, Reviewed badge, note, DietaryEditor; reviewed count; Import; Back.
- [x] Done: result counts incl. withdrawn and skipped; View people; Print lanyards.

## Import & check (`Intake.tsx`, `/people/import`)

- [x] Loads import context and registrations and local (browser) state; skeleton; LoadError with retry of both.
- [x] ⋯ menu: Import with column matching.
- [x] Upload: multiple files, disabled while busy; reads files, commits to roster in chunks of 1000, detects changes, takes off people in neither file (confirm when > 10 and > 10%), auto "No dietary needs" for "None; None"; summary notice; error notice.
- [x] Per source: file name, people, uploaded when / not uploaded yet.
- [x] Clear from this computer (confirm).
- [x] Rows that couldn't be read (per source).
- [x] Empty state when nothing uploaded.
- [x] Counts: Dietary to read, Level to choose, Changed details, Taken off, No the consent export yet, Everyone in the files.
- [x] Dietary notes: disabled / no permission / all done texts; DietaryReview one person at a time (both notes, New badges, done-before text, prefilled text, error, DietaryEditor, Save next person, Skip for now when > 1).
- [x] Changed since last upload: list before → after, Checked per person, Mark all as checked.
- [x] Taken off the roster: list, Put back (PATCH active, kept from then on), Download the list CSV.
- [x] Choose a level: rows with select; "Chosen already" list to change.
- [x] No the consent export yet: download CSV, show names.
- [x] Matching: matched by name, in the consent export not the registration spreadsheet, couldn't be matched.

## DietaryEditor (`components/DietaryEditor.tsx`)

- [x] Entries list with Allergy/Anaphylactic badge, toggle anaphylactic for allergies, Remove.
- [x] "Checked: no dietary needs." when reviewed and empty.
- [x] Quick picks (no duplicates) and "No dietary needs".
- [x] Add something else: type, food, note, anaphylactic (allergy), Add (disabled without food).

## Notes from the check

- All items above were exercised in Chromium at 1280×900 and on an iPhone 13
  profile against the local demo camp (scripts in the session scratchpad), with
  no page errors. The large-removal confirm in Import & check (more than 10
  people and 10%) and the consent export uploads were not exercised (no the consent export
  workbook to hand); their code paths are unchanged.
- Added: People filters (level, group, allergies, no photos), chip counts,
  remembered filters and sort, "/" to search, always-on selection with bulk
  Issue lanyards / Withdraw / Restore / Delete; Leader roster day filter,
  search and clash banner; Roll sheet group filter; Import & check work areas
  behind pressable counts.
- Removed: the People ⋯ "Select people to delete…" entry (selection is always
  on now, so Delete is in the selection bar).
