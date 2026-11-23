# Organiser dashboard UI rework

Every organiser page was reworked for layout and clarity without changing what it does. Before each area was changed, every feature, button, filter, setting and state on its pages was listed; those lists are the checklists the rework was checked against:

- [People](people.md): Everyone, person, add/edit person, Leader roster, Roll sheet, Import (column matching), Import & check
- [Lanyards](lanyards.md): Design and Print
- [Programme](programme.md): Activities, activity page, add/edit activity, Import programme, Schedule, Teams, Meals, kiosk set-up, Booking links
- [Event](event.md): Home, Reports, Settings, Event details, Sections, Banner, Staff, Stations, Copy event, Links, Links for everyone, Personal links
- [Platform](platform.md): Camps, camp page, new camp/event, Events, Admin, Accounts, Activity log, Demo camps, Account, Scan hub, Not found

Shared building blocks are in `src/web/ui/Kit.tsx` (styles in `src/web/styles/kit.css`): info tips instead of paragraphs, one-line banners with an action, toolbars, filter chips with counts, summary counts, a sticky selection bar, switches, popovers, remembered filters and "/" to search.

Participant-facing pages (lanyard page, booking and sign-up pages, the kiosk, sign-in) and the scanner were not changed.
