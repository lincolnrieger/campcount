# CampCount: how participant data is handled

A short summary for reviewers. The detail is in
[`architecture.md`](architecture.md) (threat model),
[`requirements.md`](requirements.md) (data map and retention),
[`known-limitations.md`](known-limitations.md) and
[`../AUDIT.md`](../AUDIT.md) (the latest security audit).

## Importing: the file stays on the device

CampCount doesn't connect to MyScout, Consent2Go or any other system, and it
doesn't pull data from them. A camp manager exports a spreadsheet as usual
and opens it in CampCount. The file is read and filtered **in the browser on
that person's device**. The file itself is never uploaded or kept.

Only a fixed list of fields is sent to the server. The server also rejects
any other field, so nothing outside that list can be stored, even by mistake.

**Kept:** name and preferred name, membership number, youth or adult,
section, group, position, photo consent, and dietary needs entered as short
structured items (for example "Peanut, anaphylactic"). From Consent2Go it
also keeps swimming ability and the medication consent answers (such as
"Paracetamol OK"). These are health information, so only roles allowed to
see dietary details can see them.

**Never kept:** home addresses, phone numbers, Medicare numbers, guardian
details, and free-text medical notes. A manager reads the free-text notes on
their own device and enters only the dietary items needed for meals. The note
itself is not uploaded.

## Where the data is, and encryption

- Hosted on Cloudflare (Workers and the D1 database), with the database
  placed in the Oceania region. Cloudflare treats this as a location hint
  rather than a contractual guarantee that data stays in Australia.
- All traffic uses HTTPS only (HSTS enforced). Cloudflare encrypts the
  database at rest.
- Passwords are hashed and lanyard QR codes are stored only as hashes.
- There are no third-party analytics, trackers or external scripts.
- Scanner phones keep a short offline list (names, membership numbers,
  groups, plus dietary alerts on meal phones only). It's protected by the
  phone's own encryption and wiped on sign-out.

## Access and retention

- Staff sign in with their own account. Each person can only see the camps
  and the parts of a camp their role allows.
- Exports, imports, role changes and corrections are recorded in an
  append-only audit log.
- Dietary details, photo consent, medication answers and other sensitive
  fields are deleted automatically 90 days after a camp. Names are deleted
  after 2 years, and only totals are kept after that.
- The site tells search engines not to index it.

## Still to do

- Privacy impact assessment, and sign-off by the privacy officer.
- Rehearse a database restore before the first camp.
- Two open audit items (S-9, S-10 in `AUDIT.md`) need a decision.
