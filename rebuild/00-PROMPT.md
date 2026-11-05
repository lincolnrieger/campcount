# Prompt: rebuild the CampCount front end

Paste everything below the line into a new Claude Code session on this repository.

---

Rebuild CampCount's web front end (`src/web`) from scratch. The full spec is in the `rebuild/` folder at the repo root. Read every file there, in numbered order, before you write any code. Then follow it.

## What you're doing

- **A new front end on the same back end.**
  - Do not change the API, database, migrations, permissions, the server-side checks or the offline sync and scan-decoding logic.
  - If a screen truly needs something the API doesn't provide, stop and tell me rather than changing the server.
- **Start the UI again from a blank page.**
  - Delete the current `styles.css`, page layouts and components, and build new ones from `rebuild/06-design-system.md` and `rebuild/tokens.css`.
  - Keep the non-visual modules listed as "reuse" in `rebuild/08-build-plan.md`, such as API calls, session, offline store, scan decoder, CSV/XLSX import parsing and the lanyard PDF.
- **Restyle and reflow everything.** No current screen layout is sacred. Use `rebuild/03-navigation.md`, `rebuild/04-user-flows.md` and `rebuild/05-screens.md` as the target.
  - If you find a simpler flow than the spec, take it and tell me why in the report.
- **Keep every feature marked keep, move or merge** in `rebuild/02-feature-inventory.md`. Drop only what it marks drop.

## The three things I care about most

1. **Simple.**
   - One job per screen.
   - The obvious next action is always in the same place.
   - Scanning takes 2 taps or fewer from opening the app.
   - "Is anyone missing?" is answered with 0 taps on the event home.
2. **Sizing and formatting that looks right.**
   - Use only the tokens in `tokens.css`: 16px base text, five text sizes, 44px controls, the spacing scale and maximum widths. No one-off pixel values in components.
   - Everything lines up to the same edges.
   - Check this with screenshots, not by reading code.
3. **Accessible.** WCAG 2.2 AA, per `rebuild/07-accessibility.md`. Run axe on every screen at phone and desktop width. Fix everything it reports.

## How to work

1. Make a new branch, `rebuild/front-end`, from `main`.
2. **Phase 1 (foundations), then stop for my OK:**
   - The design tokens, shared components and app shell.
   - Three screens:
     - Event home (open event).
     - Scanner.
     - Person.
   - Send me screenshots of those three at 390px and 1440px wide, plus a component sheet page showing every component and state. Wait for my OK before Phase 2.
3. **Phase 2:** every remaining screen, per `rebuild/08-build-plan.md`.
4. **Phase 3, final pass:**
   - Walkthrough as every role, on phone and desktop, using `rebuild/09-acceptance.md`.
   - Screenshots at 390, 768, 1280 and 1440px of every main screen.
   - axe run, and all repo checks: `npx tsc -b && npx eslint . && npx vitest run && npm run build`.
   - Then send me the report described in `09-acceptance.md`. Open a pull request only after I've seen it.

## Rules

- Never commit real participant data. Use the demo camp or seeded test data.
- No API keys or secrets in front-end code.
- The project's lint config bans `localStorage`. Use the IndexedDB helpers in `src/web/offline/db.ts` or in-memory state.
- Don't add UI libraries. Plain React, react-router and CSS (custom properties) only.
- Make sensible decisions yourself; ask me only at the checkpoints or if you're truly blocked.
