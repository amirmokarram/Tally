# Tally

Splits costs between friends. Ported from a Google Sheets workbook; `docs/` is
the specification and `README.md` the architecture narrative. Read those for
*what* the app does — this file is *how to work on it*.

## Commands

Everything runs from `web/`, not the repo root.

```bash
cd web
npm start                                            # dev server, :4200
npm run build                                        # ~6s
npx ng test --watch=false --browsers=ChromeHeadless  # ~14s, one-shot
```

- `npm test` on its own starts **watch mode** against a real Chrome window. For
  a scripted or one-shot run, always pass
  `--watch=false --browsers=ChromeHeadless`.
- `npm run build` is the **only** check that enforces the per-component CSS
  size budget. `tsc --noEmit` and `ng test` both pass regardless of how large a
  component's styles get. Run it before pushing any change that adds CSS.
- No linter and no formatter is installed. The `prettier` block in
  `package.json` is configuration for an editor plugin, not a dependency —
  there is no `npm run format`. Match the style of the surrounding file;
  `.editorconfig` covers indentation.

## Hard invariants

Two rules that are never negotiable, because breaking either is silent:

1. **Nothing may import `ag-grid-enterprise`.** The app is AG Grid *Community*
   — MIT, no licence key. Row grouping and range selection are reimplemented
   locally, in `components/ledger-model.ts` and `components/cell-range.ts`.
2. **Nothing in `core/split-engine.ts` or `core/settlement.ts` may import
   Angular.** The engine is pure so it stays testable in isolation and portable
   to a server if the project ever grows one.

## Testing

- Specs sit beside their source as `<name>.spec.ts`. Karma + Jasmine.
- `core/split-engine.spec.ts` asserts the four worked examples from the
  original `Help.pdf` against its **published figures**. A failure there means
  the engine has diverged from the spreadsheet — fix the engine. Never edit an
  expected number to make a test pass.
- Changing `MIN_BLOCK_ROWS` or `LEDGER_ROW_HEIGHT` breaks specs that hardcode
  the resulting filler-row counts. Run the full suite, not just a build.
- Proving a *visual* fix has its own workflow — use the `verify-ui-change`
  skill. A screenshot is not available here; a rendering fix is proven with a
  spec that reads real geometry in real Chrome.
- A responsive breakpoint should be a `@container` query, not `@media`, unless
  it genuinely depends on the viewport rather than an element's own size —
  `ul { container-type: inline-size }` in `splits-panel.ts`, the same
  reasoning as the toolbar's own container query in `split-grid.ts`. Beyond
  matching what the element actually needs to respond to, only a container
  query is testable here: Karma has no way to resize the real browser window,
  but a spec can set an element's `style.width` directly and read the
  rendered layout back, real geometry included.

## Settings scope

Display preferences (totals band height, whether the totals band is
collapsed, row hover, continuous row numbers) live in `ReportSettings`
(`core/report-settings.ts`) under the `tally.settings`
storage key — separate from `tally.library` (`core/library-storage.ts`), which
holds the saved splits themselves. These settings are global, apply the same
way across every split, and never travel with an export/import.

A new display/UI preference is a new field on `ReportSettings`, following the
existing `totalsBandHeight` / `rowHoverEnabled` shape. Only put a setting on
the `Trip`/`SavedSplit` model if it is data that should travel *with* that
split — currency, or who paid.

Each setting's default appears twice: in `readSettings()`'s fallback, and again
as a render-time fallback in the template. Update both.

## Repo etiquette

Full version, including setup and the publishing gate, in `CONTRIBUTING.md` —
that file is the source of truth if these ever disagree.

- Branch off `main`, bare kebab-case (`ledger-grid`). No `feat/`-style prefix.
- History is linear. No merge commits.
- Commit subject: imperative, no prefix, no trailing period. The **body
  explains why**, not what the diff already shows — including what was tried
  and rejected. Match the tone of `git log`.
- **Pushing to `main` publishes the live public demo** to GitHub Pages
  (`.github/workflows/deploy-demo.yml`), gated on the test suite.

## Deeper background

Loaded on demand — read these when the work touches them:

- `agent_docs/ag-grid.md` — how Community substitutes for the enterprise
  features, and the integration traps.
- `agent_docs/report-layout.md` — the mobile flex chain, the CSS Grid
  auto-placement trap behind the totals band's collapse toggle, and the
  layout approaches that were tried and rejected.
