# Visual verification workflow

After ANY change that affects the design (HTML, CSS, or JS that changes what is rendered), before ending the turn:

1. Run `npm run test:visual` to see which screenshots changed.
2. Run `npm run test:visual:update` to regenerate the baseline screenshots in `tests/visual.spec.js-snapshots/`.
3. Open the updated screenshots with the Read tool and visually inspect every affected page/state, at minimum:
   - desktop and mobile
   - Chromium, plus Firefox/WebKit when layout or fonts are involved
4. Check for: overflowing/clipped/wrapping text, cramped or uneven spacing, misalignment, poor contrast, broken layout on mobile, and anything inconsistent with the rest of the design.
5. If anything looks wrong, fix it, then repeat steps 1-4 until all screenshots look correct.
6. If a new page or UI state is added, add it to `tests/visual.spec.js` so it gets a screenshot too.
7. In the final reply, briefly state which screenshots were checked and any visual issues found/fixed.

Never end a turn with a design change whose screenshots are outdated or unchecked.

---

# Notes

## Who runs the commands
- The AI runs every command above itself (tests, snapshot updates, screenshot review). The user does NOT need to run Playwright manually.
- If the user edits files themselves, they can say "check visually" and the AI will run this workflow.
- The user can optionally review before/after diffs with `npx playwright show-report`.

## Using this workflow in other projects
## This file only applies to THIS project. To reuse it elsewhere, either:
## - **Per project:** copy `.trae/rules/project_rules.md` into the other project's `.trae/rules/` folder, or
## - **All projects:** paste this rule into TRAE's global User Rules (TRAE Settings -> Rules -> User Rules) so it applies everywhere.

## One-time setup in a new project
Playwright must be set up once per project. The AI should do this automatically if it is missing (no `@playwright/test` in package.json or no `tests/visual.spec.js`):
1. `npm init -y` (only if there is no package.json; requires Node.js installed)
2. `npm install -D @playwright/test`
3. `npx playwright install` (downloads Chromium/Firefox/WebKit; only needed once per machine)
4. Create `playwright.config.js` and `tests/visual.spec.js` with `toHaveScreenshot()` tests covering each page/state at desktop and mobile sizes.
   - Static HTML: load pages via a `file://` URL.
   - Frameworks (React, Vite, Next, etc.): set `webServer` and `baseURL` in `playwright.config.js` so the dev server starts automatically during tests.
5. Add npm scripts:
   - `"test:visual": "playwright test tests/visual.spec.js"`
   - `"test:visual:update": "playwright test tests/visual.spec.js --update-snapshots"`
6. Run `npm run test:visual:update` to create the first baseline, then review the screenshots.

## Known quirks
- Screenshots are OS-specific (file names end in `-win32`, `-darwin`, `-linux`). Baselines made on Windows will not match on Mac/Linux/CI; regenerate them there.
- A "TRAE Sandbox Error: hit restricted" message after tests finish is harmless if the output shows all tests passed.
- The AI only sees static screenshots, not live animations or the user's actual browser.
