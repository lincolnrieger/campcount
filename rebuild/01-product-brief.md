# 01: Product brief

## What CampCount is

CampCount lets Scouts SA camp staff know **where every young person and leader is** during a camp. Everyone wears a lanyard with a QR code. Staff scan it:
- At the **gate** (arrived or left camp).
- At **meals** (served, with a dietary alert).
- At **activities** (signed in, optionally signed out).

Before camp, event managers set up the event, import the roster from MyScout, add activities and meals, and print lanyards. After camp they reconcile, download reports and close the event.

## Where and how it's used

- **Mostly on phones**, outdoors, often one-handed, in bright sun, with gloves or wet hands, and with patchy or no signal. Scanning must work offline and sync later. This already works; keep it.
- **On a computer** for setup and after camp: importing, editing lists, printing lanyards, reports.
- **On a shared station device** (a tablet at the gate or meal hall) paired to one job.
- **On a kiosk screen** at camp HQ where young people scan their own lanyard to sign up for activities.
- Users range from tech-confident admins to volunteer parents who've never seen the app before and get 30 seconds of training. **Design for the volunteer.**

## Who uses it

| Role | What they do at camp | What they should see first |
| --- | --- | --- |
| **Platform admin** | Sets up events and accounts, oversees everything, checks the activity log. | Events list |
| **Event manager** | Runs the camp: setup, roster, staff, live view, fixes, reports, close. | The event home: who's missing, plus Start scanning |
| **Scanner** | Scans at the gate, meals and activities. | Scan: what's on now |
| **Activity leader** | Runs one or more activities: who's booked, who's here, check in. | Their activity |
| **Meal team** | Scans meals and sees dietary alerts and who hasn't eaten. | The meal on now |
| **Station** (a device, not a person) | Scans one thing only. | The scanner, locked to its job |
| **Young person** (no account) | Books activities at the kiosk and checks their own bookings via their card's link. | Kiosk: "Scan your lanyard" |

## The jobs, most frequent first

1. **Scan** someone at the gate, a meal or an activity.
2. **Check who's missing:** who hasn't arrived, who's left, who's where right now.
3. **Find one person:** where they are, their history, mark them arrived or left by hand, see their dietary needs.
4. **Run an activity:** who's booked, who's here, check in with a tap, add a walk-in.
5. **Fix a mistake:** undo a wrong scan, withdraw or restore a person.
6. **Set up an event:**
   - Details and features.
   - Staff.
   - People: import from MyScout, or add by hand.
   - Activities.
   - Meals.
   - Lanyards.
   - Stations.
   - Open the event.
7. **After camp:** the check-up (who's still signed in), downloads, close the event.
8. **Platform admin:** accounts, activity log, demo camps, copy an event to next year.

## Principles (every decision follows these)

1. **Simple beats complete.** Each screen does one job. Show the essentials; one tap reveals the rest. If something isn't clearly useful to a volunteer at camp, it goes behind "More" or goes away.
2. **Same thing, same place.**
   - The main action is always in the same spot: the top right of the page header on desktop, and a full-width button at the bottom of the screen on phones.
   - Back is always top left.
   - Secondary actions are always in the "More" (⋯) menu.
3. **Counted taps.** The flows in `04-user-flows.md` have tap budgets. Meet them.
4. **Tell people what happened.** After every action:
   - A short toast, with Undo where possible.
   - Then go somewhere sensible.
   - Errors say what went wrong and how to fix it, with Try again.
5. **Plain words.**
   - Use verb + noun buttons.
   - Use the same word for the same thing everywhere (see the glossary in `06-design-system.md`).
   - No jargon: "card", not "credential"; "phone", not "device", except for stations.
6. **Built for phones *and* computers.** Phone layouts are designed for phones, not shrunk desktops. Desktop layouts use the space well (sidebar, tables, two columns) but never stretch text across a wide screen.
7. **Readable outdoors.**
   - High contrast.
   - 16px minimum body text.
   - Big tap targets.
   - Status always shown with a word, not colour alone.
8. **Calm and professional.**
   - No gradients, glows, emoji, illustrations, pill-shaped everything or card grids for everything.
   - Hairline borders, a restrained palette, and colour that means something.

## What went wrong before (don't repeat)

- **Too much on each screen:** dashboards with tiles, KPIs, filters, group-by selects, collapsible panels and meal summaries all at once.
- **Weird sizing:**
  - Mixed text sizes: 12, 13, 14 and 15px body copy on different screens.
  - 36px controls on desktop next to 44px on touch.
  - Odd spacing.
  - Elements not aligned to a common edge.
  - Phone screens that felt like a squeezed desktop.
- **Flow:**
  - Too many tabs.
  - Settings sub-tabs inside tabs.
  - Actions in different places on different screens.
  - Needing to know where something lives.
