# CampCount: how participant data is handled

A short summary for reviewers. The detail is in
[`data-stored.md`](data-stored.md) (every item stored),
[`database.md`](database.md) (one-page overview),
[`architecture.md`](architecture.md) (threat model),
[`known-limitations.md`](known-limitations.md) and
[`../AUDIT.md`](../AUDIT.md) (the latest security audit).

CampCount is a general tool for camps and events. It isn't tied to any one
organisation or membership system.

## Importing: the file stays on the device

CampCount doesn't connect to any other system or pull data from one. A camp
manager opens a spreadsheet (.xlsx or .csv) in CampCount, and it's read **on
their own device**. The file itself is never uploaded.

Columns are matched to CampCount's fields by their names, on the device. No
AI is used and nothing is sent while matching. The manager checks each match
and can choose "Don't send" for any field. **Nothing is sent until they press
Import**, and then only the fields they chose:

- First name (required). It can be sent in full or as an initial.
- Last name (optional). It can be sent in full, as an initial, or not at all.
- Group, level and participant ID (all optional; an ID is made if there
  isn't one).
- Photo consent, as Yes or No. Anything unclear counts as No.
- Dietary needs, as short items the manager confirms (for example "Peanut,
  anaphylactic"). Free-text notes are read on the device and never sent.

The server rejects anything else, so nothing outside that list can be stored,
even by mistake.

**Never stored:** addresses, phone numbers, emails, dates of birth, Medicare
numbers, medical conditions, medication, swimming ability, guardian and
emergency contacts, and the spreadsheet itself. If the manager chooses, the
other columns are kept in that browser only, to look up at camp; they're
never uploaded and are wiped when they sign out.

## Encryption and where the data is

- **All participant data is encrypted before it's stored:** names,
  participant IDs, groups, levels, car registrations, dietary details and
  typed lanyard codes. It uses AES-256-GCM with a key (`DATA_KEY`) held as a
  Cloudflare secret, separate from the database. Someone who got a copy of
  the database or a backup would see only scrambled values.
- People are found by participant ID using a keyed hash, so IDs are never
  stored in readable form.
- Hosted on Cloudflare (Workers and the D1 database), with the database set
  to the Oceania region. Cloudflare treats this as a location preference
  rather than a guarantee that data stays in Australia.
- All traffic uses HTTPS only, and Cloudflare also encrypts the database at
  rest.
- There are no third-party analytics, trackers or external scripts.
- Scanner phones keep a short offline list (names, participant IDs, groups,
  plus dietary alerts on meal phones only), protected by the phone's own
  encryption and wiped on sign-out.

## Access and retention

- Staff sign in with their own account. Each person sees only the camps and
  the parts of a camp their role allows.
- Exports, imports, role changes and corrections are recorded in an
  append-only audit log, which holds no names or dietary details.
- Dietary details, photo consent and car registrations are deleted
  automatically 90 days after a camp. Names are deleted after 2 years, and
  only totals are kept after that.
- The site tells search engines not to list it.

## Still to do

- Privacy impact assessment, and sign-off by the privacy officer.
- Rehearse a database restore before the first camp.
- Two open audit items (S-9 and S-11/S-12 in `AUDIT.md`) need a decision.
