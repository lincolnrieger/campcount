# CampCount — Discovery decision log

Status: **Discovery (Phase 1)**. Nothing here is final until the requirements
summary and architecture are approved. Each entry records what was decided,
why, and what is still open.

## Context (from discovery round 1, 2026-10-23)

| Topic | Answer |
|---|---|
| Connectivity | Spotty. Some events have full coverage; some get a signal only every ~10 minutes. |
| Network drop behaviour | Keep scanning on the device and sync when connected. |
| First event size | ~300 participants, ~10 activity leaders, 2 camp directors. |
| Largest event | ~400 people. Up to ~4 events per year. |
| Volunteer identity | Volunteers have Scouts SA Microsoft 365 accounts, but tenant policy can be strict. |
| Devices | Mostly personal phones; also want generic/shared "activity sign-in" or "meal sign-in" stations. |
| Participant source | MyScout export (Excel). Possibly Humanitix for some activity registrations, or manual entry. Open to lightweight public self-registration (name, email, phone; no account). |
| Adults | Included in the import, with a flag/role to distinguish them. |
| Cross-event matching | Not very important, but an **annual report of activity participation** is wanted. |
| Identifier | Membership number is always present. |
| Medical data | **Out of scope**, apart from dietary requirements. |
| Dietary | Present in the MyScout export. |
| Photo consent | Yes/no, present in the MyScout export. |
| Governance | Volunteer initiative, sanctioned for the event. |
| Data residency | Preferred but not mandatory; security is the priority. |
| Retention | No incident reporting. Annual activity-registration report required. |

## Working decisions (pending architecture sign-off)

- **D-001 Offline-tolerant scanning.** Scan workflows queue locally with
  idempotency keys and sync opportunistically. Admin, import and reporting
  screens are online-only. A printable paper roll is always available as the
  fallback.
- **D-002 No medical data.** Only dietary requirements are stored.
- **D-003 Membership number is the person key.** Matching is by exact
  membership number; there is no fuzzy matching of people.
- **D-004 Person vs registration split.** A minimal org-level person record
  (membership no., name, preferred name, youth/adult) is kept. Event-specific
  and sensitive data lives on the event registration and is purged on a
  retention schedule. Attendance facts are kept long enough for the annual
  report.
- **D-005 Passwordless sign-in.** Email one-time code or link, with passkeys.
  Entra ID (M365) SSO is optional later, if Scouts SA IT grants app consent.
  Login links must survive Microsoft Defender Safe Links pre-fetching (no
  single-use GET).
- **D-006 Station mode.** A director can pair a shared device to a single
  workflow (e.g. "Saturday lunch") for a limited time. The pairing is
  revocable and the device can only scan.
- **D-007 Opaque, event-scoped QR credentials.** Random 128-bit tokens
  (stored hashed) plus a short manual-entry code. No personal data is encoded.
- **D-009 Browser-side, allowlisted import.** The MyScout export contains
  Medicare numbers, addresses, guardian details and similar data. It is
  parsed in the browser, and only the allowlisted fields
  (`docs/requirements.md` §3) are sent to the server. The raw file is never
  uploaded.
- **D-010 Dietary review step.** Dietary text lives in MyScout's
  `medical_conditions` column. A Director turns it into structured dietary
  entries in the browser, and the original text is discarded.
- **D-011 Self-sign-up uses the lanyard code**, not email or phone
  verification. Agreed ("use your judgement"); deferred until after the
  core scanning release.
- **D-015 Counts come from replaying scans.** Scans are append-only. Every
  count, on the phone and the server, comes from replaying a context's
  scans in device-time order through `src/shared/scanRules.ts`. Offline
  syncs arriving late, and simultaneous scans on two phones, therefore
  resolve identically and are never double-counted.
- **D-016 Paper fallback.** A printable roll sheet per event. Ticks are
  entered afterwards as manual scans, which reports label as manual.
- **D-012 Reprintable credentials.** Scans match on a SHA-256 hash of the
  token. The token is also stored AES-GCM encrypted (key derived from
  `AUTH_SECRET`), so authorised staff can reprint a sheet after a printer jam
  without invalidating cards. Printing is audited like an export.
- **D-013 Excel read in the browser.** `.xlsx` files are read client-side by
  a small built-in reader (no upload, no third-party spreadsheet library),
  alongside CSV and tab-separated text.
- **D-014 Dietary change detection.** The browser sends an HMAC of the
  normalised source note (per-event key) so re-imports can flag changed notes
  for review. The note itself is never sent or stored.
- **D-008 Scale.** At 4 events/year of ~400 people, a single D1 database is
  far within limits.
