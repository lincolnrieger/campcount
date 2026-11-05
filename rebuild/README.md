# CampCount front-end rebuild

This folder is everything needed to rebuild CampCount's web front end (`src/web`) from scratch.
- **Changes:** the look, the layout and the flow.
- **Stays:** the server, database, permissions and offline scanning.

## Why

Earlier rounds kept restyling the same screens. The result still felt:
- Complicated.
- Oddly sized.
- Hard to move around in.

This rebuild starts from the jobs people actually do at camp and designs the screens around them. Exact sizing rules mean nothing looks "off".

## How to use it

1. Open a new Claude Code session on this repository.
2. Paste the contents of [`00-PROMPT.md`](00-PROMPT.md).
3. The prompt tells the session to read the other files in order, and to stop for your OK at two checkpoints:
   - After the design system and three key screens.
   - Before opening the pull request.

## Files

| File | What it is |
| --- | --- |
| [00-PROMPT.md](00-PROMPT.md) | The prompt to paste. Short; it points at everything else. |
| [01-product-brief.md](01-product-brief.md) | Who uses CampCount, where, for what, and the principles every decision follows. |
| [02-feature-inventory.md](02-feature-inventory.md) | Every feature that exists today, its API and permission, and whether it's kept, moved, merged or dropped. |
| [03-navigation.md](03-navigation.md) | The new navigation, sitemap, routes, where each role lands, and old-address redirects. |
| [04-user-flows.md](04-user-flows.md) | Step-by-step flows for each job, with tap budgets. |
| [05-screens.md](05-screens.md) | Screen-by-screen specs: purpose, content order, actions, states, phone vs desktop. |
| [06-design-system.md](06-design-system.md) | Exact type, spacing, size and colour rules, plus the component list and how each behaves. |
| [tokens.css](tokens.css) | The design tokens as a ready-to-use CSS file. Contrast is already checked. |
| [07-accessibility.md](07-accessibility.md) | WCAG 2.2 AA rules and how to test them. |
| [08-build-plan.md](08-build-plan.md) | Phases, checkpoints, what code to reuse and what to replace, file layout, testing. |
| [09-acceptance.md](09-acceptance.md) | Definition of done and the walkthrough checklist. |

## Editing

These files are yours. Change any decision before starting a session; the session treats them as the spec. Where they disagree, the order of precedence is:
1. `00-PROMPT.md`.
2. The numbered files, in order.
3. Anything the session finds in the code.
