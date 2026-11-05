# UI structure

How CampCount's screens are organised, who sees what, and why. Update this
when pages move.

## Map before the restructure (October 2026)

| Area | Page (path) | What it does | Who |
| --- | --- | --- | --- |
| Public | Sign in, Sign up, verify, set password (`/sign-in`, `/sign-up`, `/sign-in/verify`, `/set-password`) | Accounts | Anyone |
| Public | Pair (`/pair`) | Turn a shared device into a station | Anyone with a pairing code |
| Public | Sign-up screen (`/signup/:code`) | Kiosk: scan a lanyard, book activities | Anyone with the link |
| Public | Your activities (`/c#…`) | A lanyard's own bookings | Anyone holding the card |
| Main nav | Home (`/`) | Event list, Create event | Signed in |
| Main nav | Scan (`/scan`) and scanner (`/events/:id/scan/…`) | Pick what to scan; scan | Scanning roles |
| Main nav | Admin (`/admin`) | Three links: People, Activity log, Demo mode | Platform admins |
| Main nav | You (`/account`, `/account/password`) | Name, password, sign out, delete account, link to Admin | Signed in |
| Event | Overview | Notes, draft notice, Start scanning, attendee count, QR codes link, feature switches, event status buttons | Everyone on the event |
| Event | Live | Where everyone is | `reports.view` |
| Event | People (`roster`) | Roster, with four buttons: Add person, Import roster, Paper roll sheet, Lanyards, plus Delete people | `roster.view` |
| Event | Person (`roster/:id`), Add person (`roster/add`), Import, Lanyards, Roll sheet | Sub-pages of People, but Import, Lanyards and Roll sheet sat at the event's top level | Event managers |
| Event | Activities | List, inline edit forms, inline "add session" forms, inline bookings panel, cancel and delete links, add form at the bottom | Managers; leaders see only their activities |
| Event | Activity roster (`activities/:id`) | Who's booked and here; check in, book | Managers and leaders |
| Event | Meals | List with inline day pickers, cancel and delete links; add form | `meals.manage` |
| Event | Stations | Shared scanning devices | `stations.manage` |
| Event | Close-out | Check-up before closing, downloads, Close event | `reports.view` |
| Event | Staff | Who works on the event; add staff | `staff.manage` |
| Event | QR codes (reached only from an Overview card) | Lanyards text, sign-up screen link, session posters, a paragraph about stations | Managers |

Problems found:

- **Event navigation had eight tabs**, in the order features were built. Setup tools that are used once (Stations, Staff) sat beside things used all camp (Live, People).
- **Overview did five jobs:** a dashboard, feature settings, the event lifecycle, a QR codes launcher, and downloads.
- **Activities did four jobs:** a list, editing, adding sessions and managing bookings, all inline in one long list. Bookings were also on the activity's own page.
- **QR codes covered four unrelated things.** It was also only reachable from a card on Overview.
- **People's header had four equal buttons.**
- **No screen could edit an event's name, dates or location,** although the server allows it.
- **Admin was a page of three links.** Its "People" page (accounts) shared a name with the event's "People" (participants).
- **The same words meant different things:**
  - "Cancel" meant both "close this form" and "call off this activity".
  - "Remove" was used both for deleting and for unlinking.
- **"That page doesn't exist." was the whole 404 page.**

## Structure after

Main navigation, at most four items: **Events · Scan · Administration** (platform admins only) **· Account**.

- **Computers (1024px and up):** a left sidebar. It lists Events and Scan, then the current event (its name, dates and its sections), then Administration. Your name sits at the bottom and opens Account, with **View as a role** for admins. Breadcrumbs above each page show where you are, and every level is a link.
- **Phones and tablets:** a top bar with the CampCount mark, and a bottom tab bar (Events, Scan, Admin, Account). An event's sections and the Administration sections are a scrollable tab row under the page header. Sub-pages have a back link.

Event navigation, at most seven items. A tab only appears when the person's role can use it, and the server checks the same permissions.

| Tab | Holds | Shown when |
| --- | --- | --- |
| Overview | Start scanning, attendee count, staff notes; for drafts, a setup checklist that ends with **Open event** | Always |
| Live | Where everyone is | `reports.view`, event not a draft |
| People | Roster. Primary action: **Add person**. The ⋯ menu holds Import from MyScout, Print lanyards, Print roll sheet and Delete people. Sub-pages: person, add, import, lanyards, roll sheet | `roster.view` |
| Activities | The list, grouped by day. Primary action: **Add activity**. Each row opens the activity page (who's booked and here, check in, book). The activity page's ⋯ menu holds Edit activity, Add another session, Cancel activity and Delete activity. There is also a Sign-up screen page (kiosk link and session posters) | Activities feature on, and the person manages activities or leads one |
| Meals | Meal list. Primary action: **Add meal**. Each row has a ⋯ menu: Edit meal, Cancel meal, Delete meal | Meals feature on, `meals.manage` |
| Reports | Check-up before closing, downloads, Close event (was Close-out) | `reports.view`, event not a draft |
| Settings | Sub-tabs: **Event** (name, dates, location, notes, features, status), **Staff** and **Stations** | Any of `event.configure`, `staff.manage`, `stations.manage` |

Admin navigation: **Accounts · Activity log · Demo camps**. `/admin` opens Accounts.

Old addresses redirect to the new ones, so bookmarks keep working: `roster/*` goes to `people/*`, `close-out` to `reports`, `staff` and `stations` to `settings/…`, `qr-codes` to `activities/signup`, and `import`, `lanyards` and `roll-sheet` to `people/…`.

## Conventions

- **Words:**
  - **Delete** means gone for good, and always asks first.
  - **Remove** takes something off a list, like staff from an event or a booking from a session, and the thing itself stays.
  - **Cancel** on its own only ever closes a form. Calling something off is "Cancel activity", "Cancel meal" or "Cancel event", and the matching undo is "Restore …".
- **Buttons:** one primary button per page header, on the right of the header row (below the title on phones). Secondary actions go in the ⋯ menu. Destructive actions sit at the bottom of a menu or page, under a divider.
- **Feedback:**
  - Success shows a toast, and reversible changes offer **Undo**.
  - A failed load shows a plain message with **Try again**.
  - Buttons say what they are doing ("Saving…") and are disabled while working.
- **Back links:** every sub-page starts with a back link to its parent, and the browser tab title names the page.

## Design system (November 2026)

Defined once in `src/web/styles.css`; use the tokens, never one-off values.

- **Type:** the system UI font. Six sizes:
  - 12px: table headers and labels.
  - 13px: meta text and hints.
  - 14px: body text (15px on phones).
  - 16px: section headings.
  - 20px: page titles.
  - 28px: the scanner and codes only.
- **Spacing:** 4, 8, 12, 16, 24, 32 or 48px.
- **Colour:**
  - **Neutrals:** a grey ramp. All text pairs are at least 4.5:1, and control borders are 3.5:1.
  - **Brand:** eucalypt green, for primary actions and the current place.
  - **Status:** semantic colours (success, warning, error, info), each always shown with a word or a shape.
  - **Hi-vis yellow:** only for the scanner's "you are here" marks and the Demo marker.
- **Shape:**
  - Corners are 4px on controls and 6px on surfaces.
  - Hairline borders, no drop shadows on content (menus and dialogs only), no pills.
  - Controls are 36px tall with a mouse and 44px on touch screens.
- **Data:** lists people scan, sort or act on are tables (`.table` inside `.table-wrap`):
  - Sortable headers (`SortHeader`, `useSort`, `sortRows` in `components/Table.tsx`).
  - A toolbar above with search, filters and a count.
  - On phones, secondary columns hide (`.hide-sm`, `.hide-md`) and fold into the primary cell's sub-line (`.show-sm`).
  - The primary cell's `.row-link` makes the whole row clickable.
- **Page anatomy:** breadcrumbs (desktop), then the event header (inside an event), then `PageHeader` with the title, a one-line summary, one primary button and a ⋯ menu. Content follows; `.split` makes two columns on wide screens.
- **Feedback:** skeletons shaped like the content, `LoadError` with Try again, toasts (with Undo where reversible) and `ActionButton` busy states.
