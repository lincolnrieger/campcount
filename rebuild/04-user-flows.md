# 04: User flows

Each flow lists the steps on a **phone**, with a tap budget. Typing counts as zero taps; focusing a field counts as one. If the build needs more taps than the budget, fix the design, not the budget.

## F1. Scan at the gate (scanner, at camp): 2 taps

1. Open the app. The scanner lands on **Scan** (one event, so the picker is skipped).
2. **Tap "Gate"** (or the "On now" button if there is one). The scanner opens full-screen and the camera starts by itself, once the camera has been allowed.
   - First time only: tap "Start camera" and allow it.
3. Point at a lanyard. A beep, then the result fills the top of the screen:
   - "✓ Arrived: Sam Lee".
   - Or "✕ Not on this camp", or "Already on site".
4. Point at the next card.
5. **Tap "Out"** in the In/Out toggle when people start leaving.

Other paths:
- **No card:** tap **Find by name**, type "sam", tap the name. That's 2 taps, and it's recorded as a hand entry.
- **No signal:** a banner reads "Offline: 14 scans waiting". Scans keep working, and it syncs by itself.

## F2. Serve a meal (meal team): 2 taps

1. Open **Scan**. The current meal (for example, "Saturday lunch") is shown as **On now**.
2. **Tap it.** The scanner starts.
3. Scan. The result shows the name and a **dietary alert** in a warning box (an allergy is red, with "Allergy" written out). "No photos" shows if relevant.
4. The progress bar reads "68 of 90 served". **Tap "Who hasn't eaten"** for the list.

## F3. Is anyone missing? (event manager): 0 taps

1. Open the event. **Home** shows three counts across the top:
   - **On site** 84.
   - **Not arrived** 4.
   - **Left** 2.

   The list below shows **Not arrived** first.
2. Tap **Not arrived** (1 tap) to show only those four people.
3. Tap a person's **Arrived** button (1 tap) if they turned up without a card. A toast says "Sam Lee marked arrived. Undo".

## F4. Find a person (anyone with People): 1 tap plus typing

1. On event Home or People, tap **Find a person** and type "lee".
2. The list filters as you type. Each row shows where they are now ("At Kayaking since 10:05").
3. Tap the row to open **Person**:
   - Where they are now, in big text.
   - **Mark as arrived** or **Mark as left**.
   - Dietary needs.
   - Activities signed up for.
   - History, with "Undo this scan" on each row.

## F5. Run an activity (activity leader): 0–1 taps

1. The leader opens the app and lands on their activity, for example **Kayaking, Sat 10:00–11:30**.
2. The page shows:
   - A count: "12 booked · 8 here".
   - A **Scan** button.
   - The booked list with a **Check in** button on each row. Not-here people come first.
3. Tap **Check in** on a row (1 tap). The row moves to "Here".
4. To add a walk-in: tap **Add someone**, type a name and tap it. If capacity allows, they're booked and checked in.

## F6. Set up an event (event manager, on a computer)

The **Get ready** checklist on a draft event's Home guides the order. Each step links to its screen and ticks itself when done.

1. **Create event** (platform admin): name, first and last day, location. Save, and you land on the new event's Home with the checklist.
2. **Add staff:** Settings › Staff › Add staff. Pick an existing account or type an email. Choose a role (and an activity for activity leaders). Save. An invite link appears to copy and send.
3. **Add people:** People › More › Import from MyScout.
   1. Choose the file.
   2. Match the columns. Known MyScout headers are matched automatically.
   3. Check the list: new, updated, unchanged.
   4. Review dietary needs.
   5. Import.

   This lands on People with a toast: "Imported 86 people".
4. **Add activities:** Activities › Add activity. Enter the name, day, start, end and place. Advanced options (capacity, sign-out, booking) are under "More options". Save, and you land back on Activities with the new row highlighted. Use "Add another session" from its More menu to repeat it later in the day.
5. **Add meals:** Meals › **Add a day of meals**. Pick the day, and breakfast, lunch and dinner are created. Or use "Add meal" for a single one.
6. **Print lanyards:** People › More › Print lanyards › Download PDF.
7. **Open event:** the last item in the checklist. Confirm, and scanning becomes available.

## F7. After camp (event manager)

1. **Reports** › **Check-up** lists:
   - People still signed in at activities.
   - People still on site.
   - Dietary reviews pending.
   - Phones with unsynced scans.

   Each item has a fix. For example, "Sign everyone out of Kayaking" asks for a reason and confirms first.
2. **Downloads:** one button per CSV, each with a one-line description.
3. **Close event:** at the bottom. It confirms with what it will do; the event becomes read-only and can be reopened by an event manager.

## F8. Copy an event to next year (platform admin)

1. Settings › **Copy event**.
2. Enter the name and first day, defaulting to the same weekday next year. Leave "Activities" and "Meals" ticked.
3. **Copy event.** You land on the new draft's Home, with the checklist.

## F9. Admin: add an account

1. **Admin › Accounts › Add account.** Enter the name and email, and tick "Platform admin" if needed.
2. Save. A password-setup link is shown to copy.

## F10. Kiosk: book an activity (young person)

1. Camp HQ screen: "Scan your lanyard". Hold the card to the camera, or type the code.
2. "Hi Sam" appears with today's sessions as large buttons, marked Booked, Full or Book.
3. Tap **Book**. "Booked: Kayaking 10:00". It resets after 90 seconds idle, or on "Done".

## After-action rules (apply everywhere)

| Action | Where you go | Feedback |
| --- | --- | --- |
| Create something | Its new page, or back to the list with the new row highlighted | Toast: "Activity added" |
| Save an edit | Back to where you came from | Toast: "Changes saved" |
| Delete | Back to the list | Confirm dialog first, then toast: "Deleted Kayaking". No undo for delete. |
| Cancel or restore, withdraw or restore, arrived or left by hand | Stay on the page | Toast with **Undo** |
| Scan | Stay in the scanner | Big result, beep, and a live-region announcement |
| Error | Stay on the page | Message beside the field (forms), or an error box with **Try again** (loads) |
