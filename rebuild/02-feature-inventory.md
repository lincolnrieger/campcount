# 02: Feature inventory

Every feature in the current front end, the API it uses, who can use it, and what happens to it in the rebuild.

**Decisions:**
- **Keep:** same place in the new structure.
- **Move:** somewhere new.
- **Merge:** folded into another screen.
- **Simplify:** kept, with fewer options.
- **Drop:** removed from the UI. The API stays, so it can come back.

The server enforces every permission listed. The UI only hides what a role can't use. API paths are relative to `/api`. `E` means `/events/:eventId`.

## Signing in and accounts

| Feature | API | Who | Decision |
| --- | --- | --- | --- |
| Sign in with email code, or with password | `POST /auth/request`, `/auth/verify`, `/auth/password/sign-in` | Anyone | **Keep.** One screen: email first, then password or "Email me a code". |
| Sign up (create account) | `POST /auth/signup`, `/auth/verify` | Anyone | **Merge** into sign-in: an unknown email offers "Create account". |
| Set or reset password from an emailed link (`/set-password`) | `POST /auth/link/check`, `/auth/link/use` | Link holder | **Keep** |
| Account: change name, change password, sign out, delete my account | `PATCH /me`, `POST /auth/password`, `POST /auth/sign-out`, `DELETE /me` | Signed in | **Keep.** One screen, with Delete account at the bottom behind a confirm. |
| View as a role (admins preview the app as another role) | `POST/DELETE /admin/preview`, `GET /admin/preview/options` | Platform admins | **Move** to Account › "View as a role". The banner stays while previewing. |
| Pair this device as a station (`/pair`) | `POST /stations/pair` | Code holder | **Keep** |

## Events

| Feature | API | Who | Decision |
| --- | --- | --- | --- |
| Events list (search, status filter) | `GET /events` | Signed in | **Simplify:** current and upcoming first, past events under a "Past events" heading. Search only appears when there are more than 8 events. |
| Create event (name, dates, location, notes, features) | `POST /events` | `platform.events.create` | **Keep** as its own page. Defaults: all features on except Photos and Self sign-up. |
| Edit event details and features | `PATCH /events/:id` | `event.configure` | **Move** to Settings › Event details. |
| Event status: open, complete, reopen, archive, cancel | `POST /events/:id/transition` | `event.configure` / `event.close` | **Move:**<br>- **Open event:** the draft checklist on Home.<br>- **Close event:** Reports.<br>- **Cancel, archive and reopen:** Settings › Event status. |
| Copy event to new dates | client-side, via `POST /events`, staff, activities and meals | `platform.events.create` | **Keep** in Settings. |
| Draft setup checklist | reads registrations, activities, staff, meals | `event.configure` | **Keep** on Home for draft events. |

## Live view and people

| Feature | API | Who | Decision |
| --- | --- | --- | --- |
| Where everyone is (on site / not arrived / left / at activity) | `GET E/whereabouts` (and `E/live`) | `reports.view` | **Keep** as the core of event Home. **Simplify:**<br>- Three counts that act as filters.<br>- Find a person.<br>- One list, with no "group by" select. |
| Arrived / Left by hand | `POST E/scans` (method `manual`) | `site.scan` | **Keep** on Home rows and the Person screen. |
| Live counts per activity and meal | `GET E/live` | `reports.view` | **Move** to the Activities and Meals lists (a "here now" / "served" count on each row). |
| Scanning phones last seen (sync health) | `GET E/live` | `reports.view` | **Move** to Reports › Check-up. |
| People list (search, filter by status, section, group, card) | `GET E/registrations` | `roster.view` | **Simplify:**<br>- Search, and one filter select: All, Youth, Leaders, Withdrawn, No card.<br>- Sortable columns on desktop. |
| Person: details, where now, history, signed-up activities | `GET E/registrations/:id` | `roster.view` | **Keep** |
| Edit person details | `PATCH E/registrations/:id` | `roster.edit` | **Keep:** "Edit details" opens a form page. |
| Dietary needs (view, edit, review) | `PUT E/registrations/:id/dietary` | `dietary.view_detail` / `dietary.edit` | **Keep** on Person. |
| Photo consent flag | in the registration | `photo.view_status` | **Keep:** "No photos" status on Person and in scan results. |
| Lanyard: issue, replace, download one card | `POST E/credentials/issue`, `/credentials/print` | `credentials.manage` | **Keep** in Person's More menu. |
| Withdraw from event, restore to event | `PATCH E/registrations/:id` | `roster.edit` | **Keep** in Person's More menu. |
| Delete person | `DELETE E/registrations/:id` | `roster.edit` | **Keep** in Person's More menu, last, behind a confirm. |
| Delete several people (select mode) | same, many | `roster.edit` | **Keep** in People's More menu ("Select people to delete…"). |
| Undo a wrong scan (void) from history | `POST E/scans/:scanId/void` | `attendance.correct` | **Keep** on Person history rows ("Undo this scan"). |
| Add person by hand | `POST E/registrations` | `roster.edit` | **Keep** |
| Import from MyScout (CSV/XLSX, parsed in the browser; match columns, check, dietary review) | `GET E/import/context`, `POST E/import/preview`, `/import/commit` | `roster.import` | **Keep** as a step-by-step page with clear step numbers. |
| Print lanyards (issue missing, PDF) | `POST E/credentials/issue`, `/credentials/print` | `credentials.manage` | **Keep** in People's More menu. |
| Paper roll sheet (print) | `GET E/registrations` | `roster.view` | **Keep** in People's More menu. |

## Scanning

| Feature | API | Who | Decision |
| --- | --- | --- | --- |
| Scan tab: pick event, then pick what to scan (gate, meal, activity), with "On now" first | `GET /events`, `E/activities`, `E/meals` | Scanning roles | **Simplify:** see `05-screens.md`. With one event the picker is skipped. With exactly one thing "on now", show it as a big button at the top. |
| Scanner: camera, QR decode (BarcodeDetector, then jsQR fallback), offline queue, sync | `GET E/scan/.../snapshot`, `POST E/scans` | `site.scan`, `meal.scan`, `activity.scan` | **Keep** the logic; **rebuild** the screen. |
| In / Out direction | — | same | **Keep** as a two-option toggle at the top. |
| Result: name, accepted or refused and why, repeat, dietary alert (meals), no-photos flag | — | same | **Keep.** The result is huge and has an icon plus a word. |
| Find by name, or type the card code | uses the offline snapshot | same | **Keep** as one "Find by name" sheet. Typing the code is a link inside it. |
| Progress count ("42 of 90 arrived / served"), last 5 scans | — | same | **Keep** |
| Who's eaten / who hasn't (meals) | `GET E/meals/:id/served` | `meal.scan` | **Keep** as a "Who hasn't eaten" sheet. |
| Sound on/off | — | same | **Keep** |
| Sync status chip (offline, queued, synced) | — | same | **Keep** |
| Station mode (a device locked to one job, "Unpair this device") | `/me` (station principal) | Station | **Keep** |

## Activities

| Feature | API | Who | Decision |
| --- | --- | --- | --- |
| Activities list by day (search, day filter) | `GET E/activities` | `activities.manage` or leader | **Simplify:**<br>- Day tabs (Today first), then rows.<br>- Each row shows the time, name, place and "12 booked · 8 here".<br>- Search only when there are more than 15 activities. |
| Add or edit activity (name, times, place, capacity, sign-out, repeat, booking required, sign-up open) | `POST/PATCH E/activities` | `activities.manage` | **Keep.** Advanced options are behind "More options" in the form. |
| Add another session (copy with the next time) | `POST E/activities` | `activities.manage` | **Keep** in the activity's More menu. |
| Cancel / restore activity, delete activity | `PATCH`, `DELETE E/activities/:id` | `activities.manage` | **Keep** in the More menu (delete last). |
| Activity page: booked, here, check in or out by tap, add walk-in, remove booking, print | `GET E/activities/:id/bookings`, `/attendance`, `POST/DELETE .../bookings`, `POST E/scans` | `activity.view_roster`, `activity.bookings`, `activity.scan` | **Keep.** This is the activity leader's home. |
| Sign-up kiosk link and session posters (QR) | `GET E/signup`, `POST E/signup/new-link` | `activities.manage` | **Move** to Activities › More › "Sign-up kiosk and posters". |
| Kiosk screen (`/signup/:code`): scan lanyard, book or cancel sessions | `/public/signup/...` (event, identify, book, cancel) | Public with link | **Keep:** full-screen, very large text, idle reset. |
| My activities (`/c#code`) from a lanyard | `/public/signup/...` | Card holder | **Keep** |

## Meals

| Feature | API | Who | Decision |
| --- | --- | --- | --- |
| Meals list by day | `GET E/meals` | `meals.manage` | **Keep:** day tabs plus rows ("68 of 90 served"). |
| Add meal (quick: day plus Breakfast, Lunch, Dinner or Other) | `POST E/meals` | `meals.manage` | **Keep.** Add "Add a day of meals" (adds breakfast, lunch and dinner in one go). |
| Edit, cancel, restore, delete meal | `PATCH/DELETE E/meals/:id` | `meals.manage` | **Keep** in the row's More menu. |

## Reports and closing

| Feature | API | Who | Decision |
| --- | --- | --- | --- |
| Check-up before closing: still signed in, pending dietary reviews, phones not synced; "Sign everyone out" per place | `GET E/reconciliation`, `POST .../sign-out-all` | `reports.view`, `attendance.correct` | **Keep** as Reports › Check-up. |
| Downloads (CSV): all scans, activity summary, meal counts, arrivals and departures, named dietary list | `GET E/exports`, `E/exports/:name.csv` | `reports.export`, `reports.export_sensitive` | **Keep** as a simple list of download buttons, each with a one-line description. |
| Close event | `POST /events/:id/transition` | `event.close` | **Keep** at the bottom of Reports. |

## Settings

| Feature | API | Who | Decision |
| --- | --- | --- | --- |
| Staff: list, add (pick an account or invite by email), role, activity scope, change role, remove, resend invite link | `GET/POST/PATCH/DELETE E/staff`, `POST E/staff/:id/invite` | `staff.manage` | **Keep** as Settings › Staff. |
| Stations: set up (pairing code and QR), edit, stop, reopen | `GET/POST/PATCH/DELETE E/stations`, `POST .../reopen` | `stations.manage` | **Keep** as Settings › Scanning stations. |
| Features on or off (activities, meals, gate, dietary, photos, self sign-up) | `PATCH /events/:id` | `event.configure` | **Keep** in Settings › Event details. |

## Administration (platform admins)

| Feature | API | Who | Decision |
| --- | --- | --- | --- |
| Accounts: list, search, filter, add, rename, make or remove admin, disable or enable, password link, delete | `/admin/users...` | `platform.users.manage` | **Keep** |
| Activity log (audit), with filters | `GET /admin/log`, `/admin/audit` | `platform.audit.read` | **Keep** |
| Demo camps: create, delete, sign in as demo roles | `/admin/demo...` | `platform.users.manage` | **Keep** |

## Dropped or simplified away

- **Live board "Group by"** (by place, Scout group, section): **drop.** It's one list with filters.
- **Collapsible "scanning phones" panel on the dashboard:** **move** to Reports › Check-up.
- **Meal summary on the dashboard:** **move** to the Meals list.
- **KPI tiles beyond the three counts:** **drop.**
- **Breadcrumbs:** **drop.** The sidebar highlight, page title and back button do the job. Breadcrumbs added a third navigation system.
- **Settings sub-tabs:** **replace** with a Settings index page that lists sections. Each section is its own page with a back link.
- **The People "Status", "Section", "Group" and "Card" filter selects:** **merge** into one filter select.
