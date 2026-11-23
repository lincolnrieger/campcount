# UI rework: People — inventory

Everything below must still work after the rework. Ticked when checked in the
browser (desktop 1280×900 and iPhone 13) after the rework.

## People › Everyone (`Roster.tsx`, `/people`)

- [ ] Loads `GET /events/:id/registrations`; skeleton rows while loading; LoadError with Try again on failure.
- [ ] Header: title "People"; summary of active count, youth and leaders.
- [ ] "Add person" primary button → `people/add` (needs `roster.edit`).
- [ ] Notice: N people without a lanyard, link to `lanyards/print` (needs `credentials.manage`, only when > 0 active people have no code).
- [ ] Empty event: EmptyState with "Import from MyScout" (→ `import`, needs `roster.import`) and "Add person" (needs `roster.edit`).
- [ ] Search by name, preferred/first name, member number, lanyard code, group.
- [ ] Filter: Everyone (active), Youth, Leaders, No lanyard, Withdrawn (withdrawn list shows only withdrawn).
- [ ] Count of people shown (live region).
- [ ] Sort by Name (last name then first), Section/role, Scout group, Lanyard; toggle direction (wide table).
- [ ] Wide (≥1024px): table, name links to the person page; columns Name, Section (role for adults), Scout group, Lanyard code, Status badges.
- [ ] Narrow: list rows with name link, meta "role · group", badges; withdrawn rows muted.
- [ ] Badges: Withdrawn, No photos (photo feature on and consent no), Allergy, No lanyard (active only).
- [ ] No matches: EmptyState with "Clear search and filter".
- [ ] Bulk delete (needs `roster.edit`, people exist): enter select mode from ⋯ menu "Select people to delete…"; checkboxes per row; select all shown; count; "Delete selected" (disabled at 0) with danger confirm (single vs many wording); deletes one by one via `DELETE /registrations/:id`; toast success, partial failure toast "Deleted x of n."; reload; Cancel leaves select mode and clears.

## People › Add person (`AddPerson.tsx`, `/people/add`)

- [ ] Back link to People. Title "Add person".
- [ ] `PersonFields` form (youth sections, photo question if feature on, dietary if feature on, youth/leader labels).
- [ ] Local validation: first name, last name, member number unless "Not a Scouts member"; ErrorSummary linking to fields.
- [ ] Server field errors shown; failure message in summary; no-connection message.
- [ ] Submit `POST /registrations`; toast "Added …"; navigate to the person page (or People) with replace.
- [ ] Busy state "Adding…"; Cancel → People.

## Person page (`Person.tsx` › `Person`, `/people/:id`)

- [ ] Loads `GET /registrations/:id`; skeleton; LoadError (404 → "This person is no longer on the event.").
- [ ] Back link: Home when opened from home (location state `from: 'home'`), otherwise People.
- [ ] Header: full name; summary section · position (adults) · group; badges Withdrawn, No photos, Allergy.
- [ ] Primary "Mark as arrived" / "Mark as left" (event open, site feature, `site.scan`, where.site known, active) → manual site scan; toast or error toast; reload.
- [ ] ⋯ menu: Edit details (→ `edit`, can.edit); Download lanyard (can.cards, has code → PDF of the camp design, both sides); Issue lanyard (can.cards, active, no code); Replace lanyard (confirm); Withdraw from event (confirm; toast with Undo) / Restore to event; Delete person… (danger confirm mentions scan count; navigates to People).
- [ ] Right now panel: on site since / left at / not arrived; activities currently at; last scanned line.
- [ ] Dietary needs (when `dietary` present): list with Allergy badge; "None recorded."; Edit button (can.editDietary) opens Sheet with DietaryEditor; Save (`PUT …/dietary`), toast, reload; Cancel.
- [ ] Activities: bookings with day, time range or "Any time", "booked by leaders"; empty text.
- [ ] Lanyard panel: section colour word, section name, QR (can.cards and code; loaded via `credentials/print` view), loading / failed text, short code; "No lanyard issued yet."
- [ ] History grouped by day, newest first: time, verb · place, by whom, method, outcome badge; void struck; ⋯ "Undo this scan" (needs `attendance.correct`, not void/rejected) with confirm → `POST /scans/:id/void`.
- [ ] Details list: name (+ goes by), membership number or "Not a member", section, role (adult), car rego (adult), group, team, extra import fields, photos, lanyard code (can.cards).

## Edit details (`Person.tsx` › `PersonEdit`, `/people/:id/edit`)

- [ ] Loads person; skeleton; LoadError. Back link to the person.
- [ ] Fields: first, last (required), goes by, membership number, section (select incl. current unknown section; hint says youth/adult), Scout group, Role (adult sections only), Car rego (adult kind), Photos (when consent field exists), extra import fields (clear to remove).
- [ ] Only changed fields sent via PATCH; field errors; failure message; Saving… busy; toast "Changes saved" and back to person; Cancel.

## Leader roster (`LeaderRoster.tsx`, `/people/leader-roster`)

- [ ] Loads `GET /duties`; skeleton; LoadError; EmptyState "No duties yet" with Add duty.
- [ ] "Add duty" primary (needs `roster.edit` and event draft/open).
- [ ] View toggle: By duty / By leader.
- [ ] By duty: grouped by day; each duty card with time range · location, notes, people list, Remove per person (editable), Add leader button, ⋯ menu Add leader / Edit duty / Delete duty… (confirm).
- [ ] By leader: each leader with their duties (day, time, title, location), Clash badge on overlaps; empty text.
- [ ] Duty sheet: title (required), day (event days), start, end (optional, must be after start), where, notes; ErrorSummary; failure Notice; create (POST) or edit (PATCH); toast; reload.
- [ ] Leader picker sheet: search (autofocus); leaders by default, search finds anyone (top 40 ranked); "On this duty" (disabled), "Busy then" (overlapping duty), "Adding…"; stays open to add several; empty texts.

## Roll sheet (`RollSheet.tsx`, `/people/roll-sheet`)

- [ ] Loads registrations; skeleton; LoadError.
- [ ] Print button (window.print) once loaded.
- [ ] Heading (optional), tick columns (comma separated, max 6), Who: Everyone / Youth only / Leaders only.
- [ ] Printed sheet: title, camp name, printed date, privacy line; table Name, Scout group, tick columns; active people only, sorted by group then last name. Controls hidden in print.

## Import with column matching (`Import.tsx`, `/people/import/columns`)

- [ ] Loads `GET /import/context`; skeleton; LoadError.
- [ ] Source: MyScout or Consent2Go (also from `?source=consent2go`); title follows the source; Consent2Go summary.
- [ ] Stepper: MyScout file → match → check → dietary → done; Consent2Go skips match.
- [ ] Error Notice for failures.
- [ ] File step: source choice with descriptions, privacy note, file input (accept by source), "Reading…".
- [ ] Map step: file name, rows and column counts; each target field with select (Not in this file), sample of the first row, optional marks; other columns to keep (up to MAX_EXTRA_FIELDS, sensitive columns hidden with count); dietary column warning (needs review / switched off); missing required warning; Next disabled when missing; Back.
- [ ] Check step (before plan): N ready; Consent2Go tabs list with skipped reasons; problems (first 8, download CSV); Next (preview) busy "Checking…", disabled with no valid rows; Back.
- [ ] Check step (plan): counts New / Changed / No change / Dietary to review; problems; "Mark people not in this file as withdrawn" (MyScout only, re-previews, shows count); "See what changed" list; Next to dietary (when reviewing and pending) or Import N people (commit); Back.
- [ ] Dietary step: explanation; NothingToRecord panel (ticked list, untick, mark N as no dietary needs, done + Undo); review items with name, group, member, Reviewed badge, note, DietaryEditor; reviewed count; Import; Back.
- [ ] Done: result counts incl. withdrawn and skipped; View people; Print lanyards.

## Import & check (`Intake.tsx`, `/people/import`)

- [ ] Loads import context and registrations and local (browser) state; skeleton; LoadError with retry of both.
- [ ] ⋯ menu: Import with column matching.
- [ ] Upload: multiple files, disabled while busy; reads files, commits to roster in chunks of 1000, detects changes, takes off people in neither file (confirm when > 10 and > 10%), auto "No dietary needs" for "None; None"; summary notice; error notice.
- [ ] Per source: file name, people, uploaded when / not uploaded yet.
- [ ] Clear from this computer (confirm).
- [ ] Rows that couldn't be read (per source).
- [ ] Empty state when nothing uploaded.
- [ ] Counts: Dietary to read, Section to choose, Changed details, Taken off, No Consent2Go yet, Everyone in the files.
- [ ] Dietary notes: disabled / no permission / all done texts; DietaryReview one person at a time (both notes, New badges, done-before text, prefilled text, error, DietaryEditor, Save next person, Skip for now when > 1).
- [ ] Changed since last upload: list before → after, Checked per person, Mark all as checked.
- [ ] Taken off the roster: list, Put back (PATCH active, kept from then on), Download the list CSV.
- [ ] Choose a section: rows with select; "Chosen already" list to change.
- [ ] No Consent2Go yet: download CSV, show names.
- [ ] Matching: matched by name, in Consent2Go not MyScout, couldn't be matched.

## DietaryEditor (`components/DietaryEditor.tsx`)

- [ ] Entries list with Allergy/Anaphylactic badge, toggle anaphylactic for allergies, Remove.
- [ ] "Checked: no dietary needs." when reviewed and empty.
- [ ] Quick picks (no duplicates) and "No dietary needs".
- [ ] Add something else: type, food, note, anaphylactic (allergy), Add (disabled without food).
