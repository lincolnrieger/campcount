# 03: Navigation and structure

## The shape of the app

There are two levels, and never more than two navigation bars on screen:

1. **App level:** Events · Scan · Admin (platform admins only) · Account.
2. **Event level** (inside an event): Home · People · Activities · Meals · Reports · Settings. Each tab only appears if the role can use it *and* the feature is on.

Everything deeper is a **sub-page** with a back button, never another row of tabs.

## Phone (under 1024px)

```
┌──────────────────────────────┐
│ ‹ Back      Page title    ⋯  │  top bar: back (on sub-pages), title, More menu
├──────────────────────────────┤
│ Home People Activities Meals…│  event tabs (inside an event only), scroll sideways
├──────────────────────────────┤
│                              │
│  content                     │
│                              │
│ [  Primary action  ]         │  sticky at the bottom, above the tab bar, when the screen has one
├──────────────────────────────┤
│ Events  Scan  Admin  Account │  bottom tab bar, always visible except in the scanner
└──────────────────────────────┘
```

- **Top bar:**
  - Inside an event, the top-level screens show the event name as the title and the tab name as the page heading.
  - Sub-pages show a back button and their own title.
- **Event tabs:** a single row under the top bar. The current tab is underlined in brand colour. On phones the row scrolls sideways if needed, and the active tab is scrolled into view.
- **Bottom tab bar:** 4 items maximum, each an icon plus a label, 56px tall plus the safe area.
- **The scanner** is full-screen: no tab bar and no event tabs. It has a close (✕) button top left that goes back to where you came from.

## Desktop (1024px and up)

```
┌────────────┬─────────────────────────────────────────────┐
│ CampCount  │  Page title                    [Primary] ⋯  │
│            │  one-line summary                           │
│ Events     ├─────────────────────────────────────────────┤
│ Scan       │                                             │
│            │  content (max width 1120px; forms 640px)    │
│ SUMMER CAMP│                                             │
│  Home      │                                             │
│  People    │                                             │
│  Activities│                                             │
│  Meals     │                                             │
│  Reports   │                                             │
│  Settings  │                                             │
│            │                                             │
│ Admin      │                                             │
│ ─────────  │                                             │
│ Your name  │                                             │
└────────────┴─────────────────────────────────────────────┘
```

- **Sidebar:** 240px wide, fixed.
  - Top: the brand.
  - Then Events and Scan.
  - Then the current event's name and its sections, indented under it.
  - Then Admin (platform admins only).
  - Bottom: your name, which links to Account.
- **No breadcrumbs.** The sidebar highlight plus the page title plus the back link are enough.
- **Content:** max width 1120px, left-aligned beside the sidebar. Forms and reading text are 640px max.

## Sitemap and routes

Keep current addresses wherever they still make sense, so bookmarks and printed QR codes keep working.

| Route | Screen | Shown to |
| --- | --- | --- |
| `/sign-in` | Sign in or create account | Anyone |
| `/set-password` | Set password from a link | Link holder |
| `/pair` | Pair this device as a station | Anyone |
| `/signup/:code` | Activity sign-up kiosk (full-screen, no app chrome) | Anyone with the link |
| `/c` | My activities (from a lanyard) | Card holder |
| `/` | Events | Signed in |
| `/events/new` | Create event | `platform.events.create` |
| `/scan` | Scan: pick what to scan | Any scanning permission |
| `/events/:id/scan/:type/:contextId?` | Scanner | That scan permission |
| `/events/:id` | Event Home | Everyone on the event |
| `/events/:id/people` | People | `roster.view` |
| `/events/:id/people/add` | Add person | `roster.edit` |
| `/events/:id/people/import` | Import from MyScout | `roster.import` |
| `/events/:id/people/lanyards` | Print lanyards | `credentials.manage` |
| `/events/:id/people/roll-sheet` | Paper roll sheet | `roster.view` |
| `/events/:id/people/:registrationId` | Person | `roster.view` |
| `/events/:id/people/:registrationId/edit` | Edit person (**new route**) | `roster.edit` |
| `/events/:id/activities` | Activities | Feature on, plus `activities.manage` or leading one |
| `/events/:id/activities/new` | Add activity | `activities.manage` |
| `/events/:id/activities/signup` | Sign-up kiosk and posters | `activities.manage` |
| `/events/:id/activities/:activityId` | Activity | Its leaders and managers |
| `/events/:id/activities/:activityId/edit` | Edit activity | `activities.manage` |
| `/events/:id/meals` | Meals | Feature on, plus `meals.manage` |
| `/events/:id/reports` | Reports (check-up, downloads, close) | `reports.view`, event not a draft |
| `/events/:id/settings` | Settings index | Any of `event.configure`, `staff.manage`, `stations.manage` |
| `/events/:id/settings/event` | Event details and features (**new route**; was the Settings index) | `event.configure` |
| `/events/:id/settings/staff` | Staff | `staff.manage` |
| `/events/:id/settings/stations` | Scanning stations | `stations.manage` |
| `/events/:id/settings/copy` | Copy event | `platform.events.create` |
| `/admin` → `/admin/accounts` | Accounts | `platform.users.manage` |
| `/admin/log` | Activity log | `platform.audit.read` |
| `/admin/demo` | Demo camps | `platform.users.manage` |
| `/account` | Account | Signed in |
| `/account/password` | Change password | Signed in |
| `/account/view-as` | View as a role (**new route**) | Platform admins |
| `*` | Not found, with links back | Anyone |

**Admin sub-navigation:** on desktop, Accounts, Activity log and Demo camps are sidebar items under Admin. On phones the Admin tab opens an index page listing the three, the same pattern as Settings.

## Redirects to keep

Old addresses must keep working:

| Old address | Goes to |
| --- | --- |
| `live` | Home |
| `roster/*` | `people/*` |
| `import` | `people/import` |
| `lanyards` | `people/lanyards` |
| `roll-sheet` | `people/roll-sheet` |
| `qr-codes` | `activities/signup` |
| `close-out` | `reports` |
| `staff` | `settings/staff` |
| `stations` | `settings/stations` |
| `/admin/users` | `/admin/accounts` |

## Where each person lands after signing in

| Who | Lands on |
| --- | --- |
| Platform admin, or anyone on several events | `/` Events |
| On exactly one event, as event manager | That event's Home |
| On exactly one event, as scanner or meal team only | `/scan` (event already chosen; "On now" first) |
| Activity leader for exactly one activity | That activity's page |
| Activity leader for several | Activities, filtered to theirs |
| Station device | Its scanner, directly |

## Role × navigation matrix

Columns: **PA** platform admin (not staffed on the event) · **EM** event manager · **Sc** scanner · **AL** activity leader · **MT** meal team.

| Tab | PA | EM | Sc | AL | MT |
| --- | --- | --- | --- | --- | --- |
| Events | ✓ | ✓ | ✓ | ✓ | ✓ |
| Scan | — | ✓ | ✓ | ✓ (own activities) | ✓ (meals) |
| Admin | ✓ | — | — | — | — |
| Account | ✓ | ✓ | ✓ | ✓ | ✓ |
| Event Home | ✓ | ✓ (full) | ✓ (scan button and own counts) | ✓ (their activities) | ✓ (meal on now) |
| People | — | ✓ | — | — | — |
| Activities | — | ✓ | — | ✓ (own) | — |
| Meals | — | ✓ | — | — | — |
| Reports | — | ✓ | — | — | — |
| Settings | ✓ (Staff only) | ✓ | — | — | — |

Check this table against `src/shared/permissions.ts` and the system roles migration. **The permissions are the truth; this table is a guide.**
