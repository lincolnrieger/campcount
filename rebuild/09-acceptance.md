# 09: Acceptance

The rebuild is done when every box below is ticked. If one can't be ticked, it goes in the report with the reason.

## Function

- [ ] Every feature marked keep, move, merge or simplify in `02-feature-inventory.md` works in the new UI.
- [ ] Every route in `03-navigation.md` loads, and every old address redirects.
- [ ] Each role sees exactly the navigation in the role matrix. Hidden means not rendered, not disabled.
- [ ] Scanning works offline: scan with the network off, see "N waiting", turn the network on, and they sync.
- [ ] Server tests, typecheck, lint and build pass.

## Flow (tap budgets from `04-user-flows.md`, counted on a 390px phone)

| Flow | Budget | Measured |
| --- | --- | --- |
| F1 Gate scan from opening the app | 2 | |
| F1 Find by name | 2 + typing | |
| F2 Meal scan from opening the app | 2 | |
| F3 See who's missing | 0 | |
| F3 Mark arrived by hand | 2 | |
| F4 Find a person | 1 + typing | |
| F5 Leader checks someone in | 1 | |

## Look and sizing (check on screenshots, not in code)

- [ ] Body text is 16px on every screen. Only the five type sizes appear (search the CSS for `font-size`: only tokens).
- [ ] Every button, input and select is 44px tall.
- [ ] No raw px, rem or hex values in component CSS, other than the allowed exceptions.
- [ ] Every page's content starts on the same left edge, and section spacing is identical across pages.
- [ ] No panel inside a panel. No gradients, emoji, illustrations or pill shapes.
- [ ] One primary button per screen, always in the same place (header right on desktop, sticky bottom bar on phones).
- [ ] No sideways scrolling at 320, 390, 768, 1024, 1280 or 1440px.
- [ ] Tables only at 1024px and up; list rows below that.
- [ ] The words match the glossary in `06-design-system.md` everywhere.

## States

- [ ] Every data view has a skeleton of the right shape, an empty state with a next step, and an error with Try again.
- [ ] Every button that calls the API shows a busy state and can't be double-submitted.
- [ ] Every create, save, delete or by-hand action shows a toast. Reversible ones offer Undo.
- [ ] Every delete asks first, naming the thing and the consequence.

## Accessibility

- [ ] axe: zero violations on every route at 390px and 1440px.
- [ ] Touch-target script: nothing under 44×44px.
- [ ] Keyboard walkthrough of: sign in, Home, Person, scanner (Find by name), add activity, delete with confirm.
- [ ] Reduced motion respected. 200% zoom works.

## Walkthrough, as each role, on a phone and a computer

Do the flows for each role. Note anything confusing and fix it:

- **Platform admin:**
  - Create event.
  - Add staff.
  - Copy event.
  - Admin accounts.
  - Activity log.
- **Event manager:**
  - F3, F4 and F6.
  - Import.
  - Lanyards.
  - Reports and close.
- **Scanner:** F1 (gate, in and out), and an activity scan.
- **Activity leader:** F5, and add a walk-in.
- **Meal team:** F2, and Who hasn't eaten.
- **Station:** pair, then scan.
- **Young person:** F10, the kiosk.

Ask at each screen:
1. Would a volunteer who's never seen it know what to do in 5 seconds?
2. Is there anything on screen they don't need right now?
3. Does it look like the other screens?

## Report to the user

1. Screenshots of every main screen at 390px and 1440px, as a contact sheet or a folder.
2. Old navigation compared with the new navigation.
3. Features kept, moved, merged or dropped (anything that differs from `02-feature-inventory.md` comes with a reason).
4. The measured tap counts table.
5. Accessibility results, plus the "needs a human" list from `07-accessibility.md`.
6. Anything you weren't sure about, or decided differently from this spec, and why.
