# All data CampCount stores

Deletion times are counted from when the camp closes, and happen
automatically.

## About participants and leaders

| Data | Why it's kept | Sensitive? | Deleted after |
|---|---|---|---|
| First, preferred and last name | Rosters, lanyards, scanning | Personal | 2 years |
| Membership number | Matching people across imports; typed code on the lanyard | Personal | 2 years |
| Youth or adult, section, group, position | Rosters and counts | Personal | 2 years |
| Team, role at camp, status (active or withdrawn) | Running the camp | Personal | 2 years |
| Photo consent (yes, no or unknown) | Marking lanyards so photographers know | Personal | **90 days** |
| Dietary needs and allergies (item, type, anaphylactic yes/no, short note) | Meals | **Health** | **90 days** |
| Medication consent answers (e.g. "Paracetamol OK") and swimming ability, from Consent2Go | First aid and water activities | **Health** | **90 days** |
| Other columns a camp manager chooses to keep (up to 12, e.g. tent or bus) | Running the camp | Varies | **90 days** |
| Leader's car registration | Contacting the owner about their car | Personal | 2 years |
| Lanyard QR code (scrambled) and typed code | Scanning | Security | Code disabled at 90 days, deleted at 2 years |
| Scans: who, where, when, in or out, which phone or staff member | Attendance and whereabouts | Personal | 2 years |
| Activity bookings, team members, duty rosters | Running the camp | Personal | 2 years |
| Side Quest: who scanned whom (optional game) | The game | Personal | **90 days** |

After 2 years, only anonymous totals are kept (for example "312 attended").

## About staff

| Data | Why it's kept | Sensitive? | Deleted after |
|---|---|---|---|
| Name and email | Signing in | Personal | When the account is removed (unconfirmed sign-ups: 7 days) |
| Password (scrambled, can't be read back) | Signing in | Security | When the account is removed |
| Role on each camp | Controlling what each person can see | Ops | Kept as history |
| Sign-in codes and sessions (scrambled) | Signing in | Security | Within a day of expiring |

## About the camp (no personal information)

Camp name, dates, location and contact email, activities, meals and menus,
scanning devices, lanyard designs and images, and import counts (numbers
only, never the file).

## Audit log

What was done, by whom and when: imports, exports, changes, sign-ins and
deletions. It holds IDs and counts only, never names, dietary details or
contact details. It can't be changed and is kept for 7 years.

## Never stored

- Home addresses or phone numbers
- Medicare numbers or guardian details
- Free-text medical notes
- The imported spreadsheet
- Device locations
- IP addresses (Cloudflare's own request logs see them, but CampCount doesn't store them)
