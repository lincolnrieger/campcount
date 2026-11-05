# 05: Screens

Every screen follows the same anatomy so nothing feels "different here":

```
Page header
  [Back]  Title                                   [Primary]  [⋯ More]
  One-line summary (optional, meta text)
Content
  sections: heading (18px) + content, 24px apart (32px on desktop)
States
  loading → skeleton of the same shape · empty → message + next step · error → message + Try again
```

On phones, the **primary action** moves to a full-width sticky button at the bottom, above the tab bar. Exceptions are the scanner (full-screen) and screens where the primary action belongs to each row.

---

## Events (`/`)

- **Purpose:** get into your event.
- **Primary action:** Create event (platform admins only).
- **Content:**
  - **Happening now:** open events, as large rows showing the name, dates, location and "84 on site".
  - **Coming up:** draft events, with an "Open {date}" label.
  - **Past events:** completed, archived and cancelled, collapsed under a "Show past events (12)" button.
  - Search appears only when the user has more than 8 events.
- **Empty:** "You're not on any events yet. An administrator adds you to an event." Platform admins see a Create event button instead.

## Create event (`/events/new`)

A single-column form, 640px wide on desktop:
- **Fields:**
  - Name.
  - First day and last day, side by side on desktop.
  - Location.
  - Notes for staff (optional).
- **Features:** a checkbox list with one-line hints, under "What will you use?":
  - Gate.
  - Meals.
  - Activities.
  - Dietary needs.
  - Photo consent.
  - Activity self sign-up.
- **Buttons:** Create event, and Cancel.

## Scan (`/scan`)

- **Purpose:** get into the scanner in one tap.
- If the user is on several open events, show an event switcher first. Remember the choice for the visit.
- **Content, in order:**
  1. **On now:** large rows (64px) for anything whose time window includes now, each with a time and progress ("Lunch · 12:00–13:00 · 40 of 90").
  2. **Gate:** "Arrivals and departures · 84 of 90 on site".
  3. **Today:** a day switcher (‹ Sat 14 Dec ›) above that day's meals, then that day's activities, as rows.
- **Empty:** "Nothing to scan yet. The event opens on {date}."

## Scanner (`/events/:id/scan/:type/:contextId?`)

A full-screen, dark camera view. This is the most important screen; get it right first.

```
┌──────────────────────────────┐
│ ✕   Gate                 🔊  │  close · context name · sound
│     ● Synced                 │  sync chip (Offline · 14 waiting / Synced)
│ [   In   |   Out   ]         │  direction toggle (gate / activities with sign-out)
├──────────────────────────────┤
│                              │
│      camera viewfinder       │
│        (square guide)        │
│                              │
├──────────────────────────────┤
│ ✓ ARRIVED                    │  result panel: green / amber / red, icon + word + name 32px
│ Sam Lee · Joeys · 1st Unley  │
│ ⚠ Allergy: peanuts           │  (meals) dietary alert
├──────────────────────────────┤
│ ████████░░  84 of 90 on site │  progress
│ [ Find by name ]             │  secondary action, full width
│ Last scans                   │
│ 10:42 Sam Lee      Arrived   │
│ 10:41 Ava Chen     Arrived   │
└──────────────────────────────┘
```

- **Before the camera is allowed:** a big "Start camera" button and one line of help. If the camera is blocked, explain how to allow it in the phone's settings, and offer Find by name.
- **Result states:** each has an icon *and* a word, with the person's name. Every result is announced by a live region (polite; assertive for refused).

  | Outcome | Colour | Example |
  | --- | --- | --- |
  | Accepted | Success (green) | "Arrived", "Served", "Signed in" |
  | Repeat, not counted | Warning (amber) | "Already served at 12:04" |
  | Refused | Error (red) | "Not on this camp", "Card replaced", "Activity full" |

- **Find by name:** a bottom sheet with a search box that focuses automatically. It searches the offline list and has a "Type card code instead" link.
- **Meals:** a "Who hasn't eaten" button opens a sheet listing names.
- **Station mode:** the same screen, but with no close button. Instead there's an "Unpair this device" item in a More menu.
- **Desktop:** the camera is centred at max 480px wide, with the result panel and recent scans beside it.

## Event Home (`/events/:id`)

**Open event, event manager:**

- **Header:**
  - Title: the event name (it's the event's home).
  - Summary: dates and location.
  - Primary action: **Start scanning**.
- **The three counts:** a row of three equal tiles, each a button that filters the list.
  - On site (success).
  - Not arrived (warning).
  - Left camp (neutral).

  The selected tile has a brand border and `aria-pressed="true"`. With the gate feature off, show "Expected" and "At activities now" instead.
- **Find a person:** a search box, full width.
- **The list:** one row per person, with Not arrived first, then On site, then Left.
  - Each row shows:
    - The name, which links to Person.
    - The section and group, as meta text.
    - Where they are, as a status badge ("On site", "At Kayaking", "Left 15:20", "Not arrived").
    - An **Arrived** or **Left** button on the right (secondary, small, 44px tall).
  - Long lists show 50 rows with "Show all 312".
  - On desktop the list is a table with columns: Name · Section · Group · Where · Action.
- **Notes for staff:** if the event has a description, show it as a collapsible "Notes for staff" box above the counts.

**Draft event, event manager:**
- The header has no primary action.
- **Get ready:** a numbered checklist. Each step is a row with a tick or a number, a label, a one-line hint and a chevron:
  1. Add staff.
  2. Add people.
  3. Add activities.
  4. Add meals.
  5. Print lanyards.
- **Open event:** a primary button under the list. It's enabled when people exist, and confirms first.

**Scanner, meal team or activity leader:** the event name, a big **Start scanning** button, and today's things they can scan (the same rows as Scan). Leaders see "Your activities" rows linking to each activity page.

## People (`/events/:id/people`)

- **Primary action:** Add person.
- **More menu:**
  - Import from MyScout.
  - Print lanyards.
  - Print roll sheet.
  - — (divider)
  - Select people to delete…
- **Toolbar:**
  - Search.
  - One filter select: All · Youth · Leaders · No card · Withdrawn.
  - A count ("86 people").
- **Phone list:** rows showing the name, then "Section · Group" as meta, with a status badge if withdrawn or missing a card.
- **Desktop table:** Name · Section · Group · Card · Status. Columns sort; the whole row is a link.
- **Empty:** "No one on this event yet." with Import from MyScout (primary) and Add person (secondary).

## Person (`/events/:id/people/:registrationId`)

- **Header:**
  - Back to People (or Home, if you came from Home).
  - Title: full name, with "goes by" in brackets.
  - Summary: Section · Group · Youth or Leader.
  - Primary action: **Mark as arrived** or **Mark as left**, when gate tracking is on and the event is open.
- **More menu:**
  - Edit details.
  - Download lanyard.
  - Replace lanyard.
  - Withdraw from event, or Restore to event.
  - — (divider)
  - Delete person…
- **Sections, in order:**
  1. **Right now:** a large status ("On site since 09:12", "At Kayaking since 10:05", "Not arrived"). It also shows the **No photos** flag if relevant.
  2. **Dietary needs:** the text, plus Edit (needs `dietary.edit`). A "Needs review" badge shows if one is pending.
  3. **Activities:** their bookings, each with day, time and name.
  4. **History:** time · what · where · how (scan / by hand / station). Each row has a "⋯" with **Undo this scan** (needs `attendance.correct`). Undone rows are struck through with an "Undone" badge.
  5. **Details:** membership number, section, group, position, as a definition list.
- **Desktop:** two columns. Right now, Dietary and Activities on the left (60%); History and Details on the right (40%).

## Edit person (`/people/:id/edit`), Add person (`/people/add`)

- **Form fields:**
  - First name.
  - Last name.
  - Goes by.
  - Youth or leader (radio).
  - Section (select).
  - Group.
  - Membership number.
  - Dietary needs.
  - No photos (checkbox).
- **Buttons:** Save changes (or Add person), and Cancel.

## Import from MyScout (`/people/import`)

- A stepper at the top: **1 Choose file · 2 Match columns · 3 Check · 4 Dietary review · 5 Done**. The current step is in bold with `aria-current="step"`.
- Each step has one primary button (Next), and Back.
- **Step 3 (Check)** shows counts (New 80 · Updated 4 · Unchanged 2 · Problems 1) and a table of problems.
- Explain once, at the top of step 1: "The file stays on this computer. Only the columns CampCount needs are sent."

## Print lanyards, Roll sheet

Simple pages:
- One sentence on what it does.
- The options (which people: all, or only those without a card).
- The primary action: Download PDF or Print.
- A preview of one card.

## Activities (`/events/:id/activities`)

- **Primary action:** Add activity.
- **More menu:** Sign-up kiosk and posters.
- **Day tabs:** one tab per camp day, plus "No time set". The tab defaults to today.
- **Rows:**
  - Time ("10:00–11:30").
  - Name.
  - Place, as meta text.
  - Counts: "12 booked · 8 here", or "12 of 16 booked" when it has a capacity.
  - A **Cancelled** badge if cancelled.
- **Activity leaders** see only their activities, with no Add button.
- **Empty:** "No activities yet." with an Add activity button.

## Activity (`/activities/:activityId`)

- **Header:**
  - Back to Activities.
  - Title: the name.
  - Summary: day, time and place.
  - Primary action: **Scan**, which opens the scanner for this activity.
- **More menu:**
  - Edit activity.
  - Add another session.
  - Print this list.
  - Cancel activity, or Restore.
  - — (divider)
  - Delete activity…
- **Counts line:** "12 booked · 8 here · 4 to come".
- **Toolbar:** a segmented control (To come · Here · All) and **Add someone** (a secondary button that opens a search sheet).
- **Rows:** the name with "Section · Group" as meta, and a **Check in** or **Sign out** button. Bookings can be removed from the row's ⋯ menu.

## Add or edit activity

- **Fields:**
  - Name.
  - Day.
  - Start.
  - End.
  - Place.
  - Instructions for leaders (optional).
- **More options** (a collapsed disclosure):
  - Capacity, plus what happens when full.
  - Track sign-out.
  - Allow repeat visits.
  - Booking required.
  - Open for self sign-up.
- **Buttons:** Save activity, and Cancel.

## Sign-up kiosk and posters (`/activities/signup`)

- **Kiosk link:** a copy button, a QR to open the link on the HQ screen, and "Make a new link" (in More, with a confirm).
- **Session posters:** a list of sessions with Download poster (PDF) for each, plus "Download all".

## Meals (`/events/:id/meals`)

- **Primary action:** Add a day of meals.
- **More menu:** Add a single meal.
- **Day tabs.** Rows show the time, name and "68 of 90 served", with a ⋯ menu: Edit meal · Cancel meal or Restore · Delete meal….
- **Empty:** "No meals yet." with Add a day of meals.

## Reports (`/events/:id/reports`)

Three sections:
1. **Check-up.** Each issue is a row with a count and a fix button:
   - "3 people still signed in at Kayaking": Sign everyone out.
   - "1 dietary need to review": Review.
   - "Phone 'Gate tablet' last synced 2 h ago": no button, just information.

   When there's nothing left, show a green "All clear".
2. **Downloads.** One row per CSV, with the name, a one-line description and a Download button. Sensitive exports carry a "Contains dietary information" label.
3. **Close event.** A paragraph on what closing does, and a **Close event** button (it confirms first). For completed events, show **Reopen event** instead.

## Settings (`/events/:id/settings`)

**Index page:** a list of rows, each with a title, a one-line description and a chevron:
- **Event details:** "Name, dates, location, notes and features".
- **Staff:** "12 people". Who works on this event and what they can do.
- **Scanning stations:** "2 stations". Shared tablets locked to one job.
- **Copy event:** "Start next year's camp from this one".
- **Event status:** Cancel event, or Archive. These are destructive, so they sit in the last section under a divider.

**Sub-pages:**
- **Event details:** the form, with fields as in Create event. The button is Save changes.
- **Staff:** primary action **Add staff**. Rows show the name, email and role (plus activity), with a ⋯ menu: Change role · Copy invite link · Remove from event.
  - The Add staff page asks:
    1. "Who are you adding?" (search accounts, or type a new email).
    2. Role (radio list with descriptions).
    3. Activity (if activity leader).
- **Scanning stations:** primary action **Set up station**. Rows show the name, what it scans and its status (Paired / Waiting / Stopped), with a ⋯ menu: Edit · Show pairing code · Reopen · Stop station.

## Account (`/account`)

- **Your details:** name (editable), email.
- **Password:** Change password (sub-page).
- **View as a role** (platform admins only): sub-page.
- **Sign out:** a secondary button.
- **Delete my account:** at the bottom, under a divider, with a confirm that asks you to type DELETE.

## Admin

- **Accounts:**
  - Primary action: Add account.
  - Toolbar: search and filter (All · Admins · No password · Disabled · Demo).
  - Rows show the name, email, badges, number of events and last active, with a ⋯ menu: Rename · Copy password link · Make admin or Remove admin · Disable or Enable · — · Delete account….
- **Activity log:** filters (who, what, event, date). Rows read as sentences: "10:42 Alex Smith signed in". A "Load more" button sits at the bottom.
- **Demo camps:** Create demo camp, then a list with "Sign in as…" buttons for each role and Delete.

## Public screens

- **Sign in:**
  - A centred card, 400px max, with the CampCount mark.
  - Email, then Continue. Then either Password plus "Sign in", or "Email me a code".
  - The code screen has one 6-digit input with `autocomplete="one-time-code"`.
- **Kiosk (`/signup/:code`):**
  - No app chrome. Text is 1.25× the normal scale and buttons are 56px.
  - Shows the camera plus "Or type the code under the QR on your card".
- **My activities (`/c`):** a simple list of bookings with Cancel buttons.
- **Pair:** the code input (auto-filled from the link), then Pair this device.
- **Not found:** "There's no page at this address", with a link to Events (and to the event's Home, if inside one).
