# UI rework: Lanyards (inventory)

The checklist of everything the two lanyard pages do. After the rework every
item must still work the same way. Routes, API calls and permission checks are
unchanged.

## Shared: Design | Print tabs (`LanyardTabs`)

- [x] "Design" tab shown only with `event.configure`.
- [x] "Print" tab shown only with `credentials.manage`.
- [x] Current tab marked `aria-current="page"`.

## People › Lanyards › Design (`/people/lanyards`, `LanyardDesigner.tsx`)

Permissions and states
- [x] Without `event.configure`: redirects to `/people/lanyards/print`.
- [x] Editable only when the camp is `draft` or `open` (and `event.configure`); otherwise read-only, with a note saying why (closed camp, or view only).
- [x] Loading state ("the lanyard design").
- [x] Load error with Try again (`ed.reload`).
- [x] Save status in the header: Saving…, Saved, error message + Try again (`ed.retrySave`). Not shown when read-only.
- [x] Phone note: the designer works best on a bigger screen.

Add (editable only)
- [x] Text, QR code, Image (upload), Background (upload, sent to back), Rectangle, Circle, Section band, No-photo mark.
- [x] Person details (one per `FIELD_IDS`): adds a field text element.
- [x] Upload accepts png/jpeg/webp; failure toasts the error; input resets.
- [x] New element becomes selected.

Layers
- [x] List for the current side, top first; empty message.
- [x] Click selects; selected highlighted.
- [x] Lock / unlock per layer (editable only).

Canvas (centre)
- [x] Front / Back side switch (clears selection).
- [x] Undo / Redo buttons (editable only, disabled when nothing to undo/redo).
- [x] Zoom out (min 50%), zoom % button resets to fit (100%), zoom in (max 300%).
- [x] CardStage: select, drag to move with snapping guides, resize handles, Shift keeps shape, Alt stops snapping.
- [x] Preview as: sample person or a real active person (needs `roster.view`; first 500).
- [x] "Show as someone without photo consent" (only if photo feature on).
- [x] Card format/orientation shown; how-to hint (drag, corners, Shift, Alt).

Keyboard (editable, not while typing)
- [x] Ctrl/Cmd+Z undo, Shift+Ctrl/Cmd+Z and Ctrl/Cmd+Y redo.
- [x] Escape deselects.
- [x] Ctrl/Cmd+D duplicates selected.
- [x] Delete/Backspace removes selected (not locked).
- [x] Arrows nudge 0.5 mm, Shift+arrows 5 mm (not locked).

Element panel (when something is selected)
- [x] Name heading + Done (close) button.
- [x] Locked note + Unlock button.
- [x] Text: words textarea (max 400), insert person detail at cursor, font picker (6 fonts with samples), size number (4–120 pt) + slider (4–72), weight select (disabled if font has one weight), align left/centre/right, capital letters toggle, wrap toggle (explanation: otherwise shrinks to fit), colour (with section text colour, camp colour).
- [x] Shape: rectangle/circle, fill (none, section), border colour (sets width 0.5 when first given), border width, corners (rect only), see-through slider.
- [x] Image: fit (Show all / Fill the box) with explanation, corners, see-through, "Add another image" (upload).
- [x] QR: note (always black on white, at least 15 mm).
- [x] No-photo mark: note (shows the mark chosen in card settings).
- [x] Position and size: left, top, width, height (QR and mark stay square); Centre across, Centre down (editable).
- [x] Arrange (editable): bring forward, send backward, duplicate, delete.
- [x] Panel scrolls to top on new selection.
- [x] Inputs disabled when not editable or locked.

Card panel (nothing selected)
- [x] Ready to print: OK message, or warnings/errors list; ones with an element select it (and switch side).
- [x] Size: each `CARD_FORMAT_KEYS` with label + detail; orientation (CR80 only); note that resizing stretches.
- [x] Background colour for the current side.
- [x] No photo consent (photo feature only): marker select (saves via PATCH `/events/:id` + reload; error toast), description per marker, border colour (colour border), "Also print No photos" (border or none markers).
- [x] Start the design again (confirm dialog, undoable).

## People › Lanyards › Print (`/people/lanyards/print`, `LanyardPrint.tsx`)

Permissions and states
- [x] Without `credentials.manage`: error notice "You don't have permission to print lanyards."
- [x] Loading state; load error with retry.
- [x] Empty: no lanyards yet.
- [x] Data: design, `POST /credentials/print` cards, `/registrations` (count of active people without a short code).

Warnings and actions
- [x] Missing lanyards: count + "Issue N lanyards" (`POST /credentials/issue {mode:'missing'}`), toast, reload.
- [x] Design errors (level error) with link to the designer (only with `event.configure`).

How to print
- [x] Layout: sheets to cut out (N per A4 page) / one card per page (card size).
- [x] Sides: both / front only / back only, with an explanation for each (depends on layout).
- [x] Dashed cut lines toggle (sheets only).

Who
- [x] Search by name or code.
- [x] Group filter (only when more than one group).
- [x] Only not printed yet (with count).
- [x] Sort: group and name (server order) / issue date newest / oldest (then name).
- [x] Only people without photo consent (only when any; with count).
- [x] N of M chosen; All; None (for those shown).
- [x] Per-person checkbox; name, issued date, printed date or "Not printed", group.
- [x] Mark chosen as not printed (only when any chosen are printed), toast.

Preview and download
- [x] Preview heading: N lanyards · P pages · print at 100%.
- [x] Nothing chosen message.
- [x] Sheets: first A4 page drawn with the same renderer, fronts or backs, with or without cut lines.
- [x] Card size: first person's front and/or back.
- [x] Security note: keep spare lanyards secure.
- [x] Download PDF (N): disabled when none chosen or busy; progress "Making your PDF… x of N"; file name `<camp>-lanyards-<a4|card-size>[-front|-back].pdf`; marks downloaded ones printed; success / error toasts.

## Added in the rework

- Print: filter chips with counts (All / Not printed / Printed), a "No photo consent" chip, a section filter, counts in the group and section dropdowns, "Clear filters", a select-all checkbox for everyone shown, "Mark printed" for the chosen (same endpoint as "Mark not printed"), a sticky bar at the bottom with the count, pages and Download PDF (progress shows there), print settings and filters remembered for the browser tab (per camp), "/" to search.
- Design: design problems as a one-line banner with Fix (selects the element) or Details (opens card settings), save status beside the tabs, arrange tools straight under the selected item's name, explanations moved into (i) tips, a two-column layout when the page is narrower (sidebar on a laptop or tablet).

Every item above was checked in a browser (Playwright at 1280, 1024 and phone widths), including a PDF download.
