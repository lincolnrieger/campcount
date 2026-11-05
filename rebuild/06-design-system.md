# 06: Design system

The tokens live in [`tokens.css`](tokens.css). Copy it to `src/web/styles/tokens.css` as the first file of the new stylesheet. **Components may only use tokens.** A raw `px`, `rem` or hex value in a component's CSS is a bug. The only exceptions are `0`, `1px` hairlines, `100%` and `50%`.

## Why the sizing looked weird before, and the rules that fix it

| Problem | Rule |
| --- | --- |
| Body text was 14px on desktop and 15px on phones | Body text is **16px everywhere**. Inputs are 16px too, which also stops iOS zooming in on focus. |
| Six or seven text sizes in use | **Five sizes only:** 13, 16, 18, 22 and 32px. |
| Bold and semibold mixed | **Two weights:** 400 and 600. |
| Controls 36px with a mouse, 44px on touch, so screens looked different on each device | **Every control is 44px**, everywhere. |
| Arbitrary gaps | Spacing comes only from the scale. A section is a heading, then 12px, then content; sections are 24px apart (32px on desktop). |
| Content stretched across wide screens, or sat in odd narrow boxes | Content max 1120px, forms and text 640px, aligned **left** next to the sidebar (not centred). |
| Things didn't line up | Every block shares the page's left edge. Row content uses the same 16px inner padding. Numbers in tables are right-aligned with `tabular-nums`. |
| Cards inside cards, and borders everywhere | **One level of container.** A list is a white panel with hairline dividers between rows. Never put a panel inside a panel. |

## Type roles

| Role | Size / weight / leading | Use |
| --- | --- | --- |
| Page title (`h1`) | 22 / 600 / 1.25 | One per page. |
| Section heading (`h2`) | 18 / 600 / 1.25 | Sections within a page. |
| Sub-heading (`h3`) | 16 / 600 / 1.5 | Groups inside a section (for example, day headings). |
| Body | 16 / 400 / 1.5 | Everything else. |
| Meta | 13 / 400 / 1.5, `--ink-3` | Secondary lines, timestamps, hints. |
| Label | 13 / 600 / 1.5, `--ink-2` | Form labels above fields, table headers. Sentence case, **not** uppercase. |
| Display | 32 / 600 / 1.25 | The three counts on Home, and the scanner result name. |

Use `font-variant-numeric: tabular-nums` for counts, times and tables.

## Layout

- **Page:** `padding: var(--page-pad)`. The content column has `max-width: var(--content-max)`.
- **Sections:** `display: grid; gap: var(--section-gap)`.
- **Two-column pages (desktop only):** a 3fr / 2fr grid with a 32px gap. On phones it becomes one column, in source order.
- **Forms:** one column, max 640px. Two short fields (such as first and last day) may sit side by side from 600px.
- **Sticky phone action bar:**
  - Background `--surface`, with a top hairline.
  - Padding 12px 16px plus the safe area.
  - One full-width primary button.
  - Sits above the tab bar.
  - The page gets matching bottom padding, so nothing hides under it.

## Components

Build these first, in `src/web/ui/`. Show every one, in every state, on a `/_components` page (dev only) for checkpoint 1.

| Component | Spec |
| --- | --- |
| **AppShell** | The sidebar at 1024px and up. Below that, a top bar (56px) plus the bottom tab bar (56px plus the safe area). It renders `<header>`, `<nav aria-label="Main">` and `<main id="main">`, plus a skip link. |
| **EventTabs** | `<nav aria-label="Event">`. Links are 44px tall, with 16px horizontal padding and a 16px label. The active tab has a 3px brand underline and `aria-current="page"`. It scrolls sideways on phones. |
| **PageHeader** | Back link (optional), `h1`, summary (meta), primary action, More menu. On desktop the title and actions share one row, with the actions aligned right. On phones the primary action becomes the sticky bottom bar. |
| **Button** | Kinds: `primary` (brand fill), `secondary` (white, control border, ink text), `danger` (error-solid fill, used only inside confirm dialogs), `ghost` (no border, brand text, for inline actions).<br>Height 44px, padding 0 16px, 16px text at 600 weight, radius 6px.<br>The busy state shows "Saving…" text, `aria-busy` and disabled.<br>A `small` variant exists only for row actions: still 44px tall, with 12px padding. |
| **IconButton** | A 44×44px button with a 20px icon and a required `aria-label`. |
| **TextField, Select, Textarea, Checkbox, Radio group** | The label sits above the field (13/600); the hint is below the label (meta). The field is 44px, with 12px padding, a control border and 16px text.<br>Errors show as error-fg text below the field with an error icon, plus `aria-invalid` and `aria-describedby`.<br>Checkbox and radio controls are 20px, inside a 44px-tall label row. |
| **SearchField** | A TextField with a search icon, `type="search"`, a clear button, and a visually hidden label. |
| **Segmented** | For In/Out and To come/Here/All. A radio group styled as joined buttons, 44px tall. The selected option has a brand fill and white text. |
| **List / Row** | A white panel with hairline dividers. Each row is at least 56px tall with 12px 16px padding. Layout: main text (16px), meta line (13px), optional status badge, and an optional trailing action or chevron.<br>A whole-row link uses a real `<a>` covering the row. A row action is a separate button, not nested inside the link. |
| **Table** (desktop) | Header at 13/600, `--ink-2`, on `--surface-sunken`. Rows are 48px with hairline dividers. Columns sort through `<button>`s in the `th`, with `aria-sort`. Below 1024px, render as List/Row instead of squeezing the table. |
| **Badge** | Inline. 13/600 text, with 2px 8px padding, radius 6px, bg/fg/border from the semantic set and an optional 16px icon. **Always contains a word.** Tones: neutral, success, warning, error, info, brand. |
| **CountTile** | A button: display-size number, label below (13/600). It has a 4px left border in its tone and `aria-pressed` when used as a filter. Three across on every width (they fit at 320px with 8px gaps). |
| **Notice** | An inline message box with a semantic bg and border, an icon, a bold title and text. Used for warnings and info inside pages. |
| **EmptyState** | Centred within the content column, with 48px vertical padding. A 16/600 message, one line of help, and one button. |
| **LoadError** | A Notice in the error tone: "Couldn't load {thing}. Check your signal and try again." with a **Try again** button. |
| **Skeleton** | Grey blocks (`--surface-sunken`) sized exactly like the content they replace: a RowSkeleton is 56px, a TileSkeleton matches a CountTile. The parent region has `aria-busy="true"` and a visually hidden "Loading {thing}". The pulse animation is off under reduced motion. |
| **Toast** | Bottom centre on desktop; above the action bar or tab bar on phones. A dark ink background with white text and an optional **Undo** button. Shown for 5 seconds (10 seconds with Undo), and stays visible while hovered or focused. Rendered in a `role="status"` live region. |
| **ConfirmDialog** | A native `<dialog>`, max 440px. It has a title ("Delete Kayaking?"), one sentence on the consequence, and buttons: Cancel (secondary) and the action named by verb ("Delete activity", danger). Focus goes to Cancel; Escape closes; focus returns to the trigger. |
| **Sheet** | A bottom sheet on phones and a centred dialog on desktop. Used for Find by name, Who hasn't eaten and Add someone. Focus is trapped, Escape closes it, and it has a close button. |
| **MoreMenu** | The ⋯ IconButton opens a disclosure list (not ARIA `menu`). Items are 44px tall. Destructive items come last, after a divider, in error-fg. Escape or clicking outside closes it, and focus returns to the trigger. |
| **Stepper** | An ordered list of steps; the current step has `aria-current="step"` and completed steps show a tick. |
| **ScanResult** | The scanner result panel. It fills the full width, with a semantic bg, a 24px icon, an uppercase word (16/600, letter-spacing 0.04em: the one place uppercase is allowed), the name in display size, and a meta line. |

## Colour use

- **Brand green** is only for:
  - Primary buttons.
  - The current nav item.
  - Selected states.
  - Links.

  Never use it for status.
- **Semantic colours** are only for status, and always with a word or an icon:
  - Success: arrived, served, signed in, synced.
  - Warning: not arrived, repeat, needs review.
  - Error: refused, allergy, delete.
  - Info: hints and offline.
- Page background is `--canvas`; panels are `--surface`. No other background colours.
- No gradients, no transparency effects and no coloured shadows.

## Icons

Use one small inline SVG set (stroke 1.75, 20px), kept in the existing `Icon.tsx` or rewritten. Only these:
- Navigation: events, scan, admin, account.
- back, close, more, search, chevron.
- check, cross, warning, info.
- sound, mute, camera, download, print, sync, offline.

Icons are decorative (`aria-hidden`) unless they're the only content of a button.

## Words (glossary)

Use these terms, and only these, everywhere:

| Use | Not |
| --- | --- |
| Event | Camp (in UI labels), project |
| People / person | Roster, registrations, participants, attendees |
| Staff | Team, users (inside an event) |
| Account | User, profile |
| Lanyard (the printed card) / card code | Credential, QR credential, badge |
| Gate | Site, on-site scanning |
| Arrived / Left | Signed on / signed off, in / out (except on the scanner's In/Out toggle) |
| Signed in / Signed out (activities) | Checked in (except the "Check in" button) |
| Served (meals) | Eaten, scanned |
| Scanning station | Device, kiosk (a kiosk is the sign-up screen) |
| Sign-up kiosk | Self sign-up screen, registration |
| Delete (gone forever, always confirms) | Remove, trash, destroy |
| Remove (take off a list; the thing stays) | Delete |
| Cancel (close a form) / Cancel activity (call it off) | Discard, abort |
| Edit / Save changes | Modify, update, submit, OK |

Button labels are verb + noun ("Add person"), in sentence case, with no full stops. Error messages say what happened and what to do, in one or two short sentences.
