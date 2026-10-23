# Known limitations (Release 1)

These are honest gaps to weigh before relying on CampCount. Each has a
mitigation or a planned fix.

## Not yet built

- **Activity self-sign-up** (participant scans a poster, then enters their
  lanyard code). The database supports bookings; the screens are not built.
- **Annual activity report across events.** All the data is kept (2 years
  named, totals indefinitely in `archive_summary`). The report screen is not
  built yet.
- **Humanitix import** for activity bookings.
- **Event templates.**
- **Passkeys.** Sign-in is by password, or by emailed code for first sign-in
  and forgotten passwords.
- **Microsoft 365 (Entra ID) sign-in.** This needs Scouts SA IT approval.
- **Editing dietary entries outside an import.** For now, change the note
  in MyScout and re-import.

## Offline

- A phone must have signal **once** after sign-in to download the list for
  each scanner it uses. The app itself then reloads without signal.
- People added to the roster after a phone last had signal are "not on this
  event list" on that phone. Their scans are still uploaded and resolved by
  the server when signal returns.
- Scans from two offline phones for the same person are reconciled when both
  upload. Until then each phone only knows its own scans.
- If a phone is lost or broken before uploading, its waiting scans are lost.
  The paper roll sheet covers this.
- The offline list on a phone is not encrypted beyond the phone's own
  device encryption. It holds display names, membership numbers, groups,
  photo markers and, on meal phones only, dietary alerts. It is wiped on
  sign-out. Someone holding an unlocked, signed-in phone can see it.

## Trust and accuracy

- Scan time comes from the phone's clock. A phone with a badly wrong clock
  produces wrong times; times more than 10 minutes in the future are flagged
  for review.
- A card is a bearer credential: anyone holding someone's card can be
  scanned as them. Scanning staff should glance at the name shown.
- Passwords are hashed with PBKDF2-SHA256 at 100,000 iterations, the
  Workers maximum, plus a server-side pepper. That is weaker per guess than
  Argon2, which Workers can't run natively. Rate limits and the pepper
  compensate. Rotating `AUTH_SECRET` also resets every password, so people
  then sign in with an emailed code and choose a new one.
- Typed backup codes are 8 characters (about 10¹¹ combinations). Only
  signed-in staff can submit them.
- Scan records are operational records, not proof of location, and do not
  replace a roll call.

## Platform

- **Data location:** the D1 database is placed in the Oceania region by a
  location hint. This is not a legal guarantee that data stays in
  Australia.
- **Retention:** the purge runs once a day. Times are UTC, so "90 days" may
  be off by up to a day.
- **Sign-in email:** it relies on Cloudflare Email Service. If the email is
  filtered as spam by Scouts SA Microsoft 365, add the sender to the allow
  list.
- **Restore rehearsal:** restore has not been rehearsed against a real
  Cloudflare account yet (no account connected). Do this before the first
  event.
- **Real phones:** camera scanning has been tested in Chromium with a
  simulated camera, not yet on real iPhone and Android devices in sunlight.
  Do this in the dry run.

## Governance (not software)

- A privacy impact assessment and Scouts SA privacy officer sign-off are
  needed before production use with real member data.
- Production access (Cloudflare account, GitHub, platform admins) should be
  held by at least two people.
