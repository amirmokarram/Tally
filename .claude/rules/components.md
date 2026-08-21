---
paths:
  - "web/src/app/components/**"
---

# Component conventions

- Filename is `thing.ts`, **not** `thing.component.ts`. The class is `Thing`,
  not `ThingComponent`. The template splits out to `thing.html` once it
  outgrows a short inline block; styles stay inline in the `.ts`.
- Never write `standalone: true`. It is the default in Angular 20 and appears
  nowhere in this codebase. There are no NgModules.
- `ChangeDetectionStrategy.OnPush` on every component.
- Dependencies come from `inject()`. There is not one constructor-injected
  parameter in the repository — do not introduce the first.
- State is `signal()` / `computed()`. The writable signal is private and named
  `xState`; it is exposed as `readonly x = this.xState.asReadonly()`.
- Members that only the template needs are `protected`, not `public`.
- Read AG Grid's live state through the `GridApi` rather than re-deriving it
  from the model — its outputs are asynchronous. See `agent_docs/ag-grid.md`.

## Adding a toolbar button to the Split tab

The Split tab's toolbar is measured, breakpoint-tuned space — see the
container-query comments above `.toolbar-cluster` in `split-grid.html`. A
permanent button per action is not free.

When two or more actions are close variants of the same thing (Export's Save
as JSON / Save as PNG, Reorder's Sheets / People, Add's Sheet / Person), give
them **one** button with a caret that opens a small `.toolbar-menu` dropdown,
rather than a permanent button each. Copy `toggleExportMenu` /
`toggleReorderMenu` / `toggleAddMenu` on the host.

Mirror the same button into the "More actions" overflow menu for narrow
screens, using a `menu-submenu-caret` instead of the toolbar caret.

Iconed options (Export) read as different destination formats; plain-text
options (Add, Reorder) read as the same kind of thing applied to a different
entity. Match whichever your two options are.

The full procedure is the `add-toolbar-action` skill.

## Confirming a destructive action

Use `ConfirmDialog` (`confirm-dialog.ts`), not `window.confirm` — the native
dialog doesn't render in some mobile browsers' embedded webviews.
`title`/`message`/`confirmLabel`/`cancelLabel` are inputs; `confirmed` and
`cancelled` are outputs. See `splits-panel.ts`'s `remove()` for the wiring:
a signal holding the pending target (or null), set on the action that would
need confirming, read by an `@if` in the template, cleared by either output.
Same fixed backdrop/panel shape as `PersonReorderDialog` /
`SheetReorderDialog` — reuse it rather than building another one-off dialog
for the next destructive action.

## Before you finish

Adding CSS here can breach the per-component style budget, and **only**
`npm run build` catches it (~6s) — `ng test` and `tsc --noEmit` will not.
`split-grid.ts` is closest to the limit.

To prove a visual change actually renders correctly, use the
`verify-ui-change` skill rather than asserting it from the diff.
