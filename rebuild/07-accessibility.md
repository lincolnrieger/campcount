# 07: Accessibility (WCAG 2.2 AA)

These are requirements, not suggestions. Each one has a way to check it.

## Rules

| # | Rule | How to check |
| --- | --- | --- |
| A1 | Text contrast is at least 4.5:1. Large text (24px, or 18.66px bold) and UI component boundaries, including focus rings, input borders and selected states, are at least 3:1. The pairs in `tokens.css` are pre-checked. **Don't invent new colours.** | axe, plus a script that reads the tokens and checks each fg/bg pair |
| A2 | Colour is never the only signal. Every status has a word, and scanner results also have an icon. | Look at screenshots in greyscale |
| A3 | Everything works by keyboard. Tab order follows the visual order, with no positive `tabindex`. | Manual: Tab through every screen |
| A4 | A visible focus ring on everything focusable: `outline: var(--focus-width) solid var(--focus); outline-offset: 2px` on `:focus-visible`. Sticky bars must not hide the focused element (2.4.11): use `scroll-padding` on `html`. | Manual |
| A5 | Use semantic HTML:<br>- `button` for actions and `a` for navigation.<br>- One `h1` per page, with headings in order.<br>- Landmarks: `header`, `nav` (labelled), `main`.<br>- Lists as `ul`/`ol`, and data tables as `table` with `th scope`. | axe, plus a heading outline check |
| A6 | Every input has a `<label>`, and hints and errors are linked with `aria-describedby`. Required fields say "(required)" in the label, or optional ones say "(optional)", consistently: **mark optional** fields. | axe |
| A7 | Form errors:<br>- On submit, show an error summary at the top (`role="alert"`) that links to each field.<br>- Move focus to the summary.<br>- Show an inline message on each field.<br>- Don't validate while the user is typing. | Manual, plus a screen reader |
| A8 | Icon-only buttons have `aria-label`. Decorative SVGs are `aria-hidden="true"`. | axe |
| A9 | Dialogs, sheets and menus:<br>- Focus moves in.<br>- Focus is trapped (dialogs and sheets).<br>- Escape closes them.<br>- Focus returns to the trigger.<br>- The background is `inert`.<br>Use native `<dialog>` with `showModal()`. | Manual |
| A10 | Live updates are announced: toasts and scan results via a `role="status"` region (scan refusals use `role="alert"`); count changes are not announced every second. | Screen reader |
| A11 | Loading states: the region has `aria-busy="true"` plus visually hidden "Loading {thing}". Skeletons are `aria-hidden`. | axe, manual |
| A12 | Touch targets are 44×44px minimum (stricter than 2.5.8's 24px; outdoor use). Inline text links in sentences are exempt. | Script: measure every interactive element's bounding box at 390px |
| A13 | Reflow: no horizontal scrolling at 320px wide or at 400% zoom on 1280px, except data tables, which switch to list rows below 1024px anyway. | Screenshot at 320px |
| A14 | Text resize to 200% doesn't clip or overlap. Use `rem` units, and no fixed heights on text containers. | Browser zoom |
| A15 | Under `prefers-reduced-motion`: no pulse, slide or smooth scroll. | Emulate in Playwright |
| A16 | Page titles: `document.title` = "{Page} · {Event} · CampCount". On route change, move focus to the `h1` (or `main`) and announce the new page. | Manual |
| A17 | `lang="en-AU"` on `<html>`. Time and date formats are Australian ("Sat 14 Dec, 10:00"). | Inspect |
| A18 | Camera: the scanner works without a camera. Find by name and typing the code are always available, so the camera is never the only way (alternative input). | Manual |
| A19 | Redundant entry (3.3.7): don't ask for the same thing twice in a flow (for example, the import flow remembers the column matches). | Review flows |
| A20 | Accessible authentication (3.3.8): the email code can be pasted, `autocomplete="one-time-code"` is set, and password fields allow password managers. | Manual |

## Automated checks (run on every screen)

- Use `axe-core` through Playwright, on every route in `03-navigation.md`, at **390×844** and **1440×900**, as each role that can see the route.
  - Zero violations is the target.
  - Any exception is written in the report with a reason.
- Keep `eslint-plugin-jsx-a11y` on, as it is already in the repo, and fix its warnings.
- Run a touch-target script that lists interactive elements smaller than 44×44px at 390px.

## Manual checks to list in the report

Automated tools can't verify these, so the final report must list them as "needs a human":

- VoiceOver on iPhone:
  - Scan at the gate.
  - Find by name.
  - Mark arrived on Home.
- TalkBack on Android: the same flow.
- NVDA or VoiceOver on desktop:
  - The import flow.
  - Add staff.
  - Delete with the confirm dialog.
- Real sunlight readability of the scanner result.
- Camera auto-start after permission on iOS Safari and Android Chrome.
