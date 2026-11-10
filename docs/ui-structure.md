# UI structure

How CampCount's screens are organised, who sees what, and why. Update this
when pages move. The design rules are in `rebuild/06-design-system.md`, and
the tokens are in `src/web/styles/tokens.css`.

## Two kinds of site

| Address | What it is | Who uses it |
| --- | --- | --- |
| `campcount.com` | **Admin console:** Camps (list, Create camp, each camp's address, colour and logo), Accounts, Activity log, Demo camps, Account | Platform admins. Staff who sign in here are sent to their camp's address. |
| `<address>.campcount.com` (for example `summercamp.campcount.com`) | **One camp's own site**, in that camp's colour, logo and name. Only ever shows that camp; the server answers 404 for anything else. | The camp's staff |

Sign-ins are separate per address. Where addresses aren't set up (for
example the workers.dev address), the main site falls back to the older
layout, with camps at `/events/<id>`.

## A camp's own site

Sections, shown only when the person's role can use them:

| Section | Holds |
| --- | --- |
| Home | Open camp: counts that filter (On site, Not arrived, Left camp), Find a person, everyone listed with Not arrived first, and Arrived/Left by hand. Draft camp: the Get ready checklist, ending with Open event. |
| Scan | Big buttons: On now, then Gate, then the day's meals and activities. One tap opens the full-screen scanner. People who only scan go straight into the scanner when there's only one thing on. |
| People | Search, one filter, and a table (computers) or list (phones). The ⋯ menu has Import from MyScout, Print lanyards, Participant links (everyone's own page link, to copy or download as CSV for emailing), Print roll sheet and Select people to delete. A person has Right now, Dietary needs, Activities, History (with Undo this scan) and Details, plus Edit details. |
| Activities | Day tabs, then rows. Each activity has who's booked and who's here, Check in, and Add someone. |
| Meals | Day tabs. Add a day of meals adds breakfast, lunch and dinner in one go. Each meal can have a menu and ingredients, shown under it for leaders to check. |
| Reports | Check-up, Downloads, Close event. |
| Settings | An index of Event details, Staff, Scanning stations and Event status. |

- **Computers:** a sidebar with the camp's logo and name.
- **Phones:**
  - A top bar with the logo and name.
  - A bottom tab bar with the first three sections, plus More for the rest and Account.

The scanner is built for outdoors (sun, rain, wet fingers) and for people who only scan. It is full screen and the camera screen never scrolls: the place and a plain count ("12 of 45 eaten"), Change (pick another place) and Settings (beep, account) at the top, the camera, a solid green / amber / red answer after each scan, and one big button with who's still to come ("Not eaten yet 33"). That opens the list: search, Not yet / Done, a big Served / Check in / Arrived button on each name for anyone without a lanyard, and Undo on the done side at meals and activities. Back to camera stays at the bottom. The upload status only shows when there's a problem (no signal, scans waiting, blocked). Close returns to the Scan buttons.

## Someone's own page (`/c#<token>`)

The QR on a lanyard opens it, and People › Participant links lists every link for emailing. Tabs: Activities (book and cancel), Teams (when there are team events), Programme (the whole camp, with places left on each activity) and Meals (each meal's menu and ingredients, so people can check them against their dietary needs).

## Conventions

- **Every page** starts with `PageHeader`: back link, title, one-line summary, one primary button, and a ⋯ menu. On phones the primary button sits at the bottom of the screen.
- **Words:**
  - **Delete** is gone for good and always asks first.
  - **Remove** takes something off a list.
  - **Cancel** on its own only closes a form.
  - Calling something off is "Cancel activity" or "Cancel meal", and "Restore …" undoes it.
- **Feedback:**
  - Toasts after every action, with Undo where it can be reversed.
  - Skeletons shaped like the content while loading.
  - A plain error with Try again when a load fails.
  - Busy buttons while work is in progress.
- **Links inside a camp:**
  - Navigation is built from `useEvent().base`: `''` on the camp's site, `/events/<id>` on the main site.
  - API calls always use `/events/<id>/…`.
