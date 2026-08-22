# Contributing

Tally is a single Angular application in `web/`, plus one Python script in
`tools/` and a set of specification documents in `docs/`.

## Setup

The CI build runs on **Node 22**; use that or newer. The Angular CLI is pinned
to 20 deliberately — do not upgrade it casually.

```bash
cd web
npm install
npm start          # dev server on http://localhost:4200
```

## Commands

All of them run from `web/`, not the repository root.

| Command | What it does |
| --- | --- |
| `npm start` | Dev server on :4200, reloads on save. |
| `npm run build` | Production build, ~6s. |
| `npx ng test --watch=false --browsers=ChromeHeadless` | Full suite once, ~14s. |
| `npx playwright test` | Full E2E suite once, headless Chromium. |

`npm test` on its own starts **watch mode** against a real Chrome window, which
is what you want while developing and not what you want in a script.
`npx playwright test --ui` is the closest E2E equivalent — an interactive
runner rather than a real-browser watch mode.

## Before you push

Run all three:

```bash
cd web && npm run build && npx ng test --watch=false --browsers=ChromeHeadless && npx playwright test
```

They catch different things. Both suites are what CI runs. The **build** is
the only check that enforces the per-component CSS size budget — `tsc --noEmit`
and `ng test` both pass no matter how large a component's styles get, so a
change that adds CSS is only verified by a build. **Playwright** is the only
check that drives the app through a real browser end to end, including the
bespoke AG Grid row-span and tick/range-select code (`components/ledger-model.ts`,
`components/cell-range.ts`) that Karma only ever asserts in isolation.

## Publishing

**Pushing to `main` publishes the live public demo.**
`.github/workflows/deploy-demo.yml` builds and deploys to GitHub Pages on every
push to `main`, gated on the Karma and Playwright suites — either one going red
blocks the deploy. This is the only place the app is visible to anyone but its
author, so a broken demo is worse than a stale one.

Two details in that workflow are easy to trip over: the build needs
`--base-href /Tally/` because Pages serves from a subpath, and the artifact
path is `web/dist/tally/browser` — the Angular project is named `tally`, which
is not the folder it lives in.

## Branches and commits

- Branch off `main`. Bare kebab-case names, like `ledger-grid` — no
  `feat/`-style prefix.
- History is linear. No merge commits.
- Commit subjects are imperative, with no prefix and no trailing period:
  *"Center the Item and Amount grid header text"*.
- **The body explains why**, not what the diff already shows — including what
  was tried and rejected, and any constraint that forced the approach. This
  repository is unusually consistent about that; `git log` is the best guide.
  For example, from `4eb5c28`:

  > Amount (100px -> 80px) and each person column (40px -> 35px) shrank the
  > total grid width in this fixture below the old 1000px threshold, failing
  > CI. The threshold only needs to prove the trip is wider than a normal
  > viewport, not hold an exact figure.

## Code style

No linter or formatter is installed. The `prettier` block in `package.json` is
configuration for an editor plugin, not a dependency, so there is no
`npm run format` — match the style of the file you are editing.
`.editorconfig` covers indentation, charset and final newlines.

Conventions worth knowing before your first component:

- Files are `thing.ts`, not `thing.component.ts`; the class is `Thing`, not
  `ThingComponent`.
- There are no NgModules, and `standalone: true` is never written — it is the
  default in Angular 20.
- Dependencies come from `inject()`. There is not one constructor-injected
  parameter in the repository.
- State is signals: `signal()` and `computed()`, with
  `ChangeDetectionStrategy.OnPush` on every component.

## Two invariants

1. **Nothing may import `ag-grid-enterprise`.** The app uses AG Grid
   *Community* (MIT, no licence key). Row grouping and range selection are
   reimplemented in `components/ledger-model.ts` and `components/cell-range.ts`.
2. **Nothing in `core/split-engine.ts` or `core/settlement.ts` may import
   Angular.** The calculation engine is pure, which is what makes the business
   model testable in isolation.

## Where things live

- `docs/` — the specification. Start with `docs/BUSINESS-RULES.md`; its rules
  are numbered and referenced from the code.
- `reference/` — the original workbook and its user guide.
- `tools/export_workbook.py` — regenerates `docs/workbook-export.json`.
- `CLAUDE.md`, `agent_docs/` and `.claude/` — instructions and background for
  AI assistants working on the repository.

The four worked examples from the original user guide are encoded as fixtures
and asserted against the guide's published figures. If they fail, the engine
has diverged from the spreadsheet — fix the engine, never the expected number.
