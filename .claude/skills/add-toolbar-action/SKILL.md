---
name: add-toolbar-action
description: Add a button or action to the Split tab's toolbar in Tally, following the existing cluster, dropdown and overflow-menu pattern. Use when adding any new toolbar command, or turning an existing button into a dropdown with a second variant.
---

# Add a toolbar action

The Split tab's toolbar is measured, breakpoint-tuned space. Four
`.toolbar-cluster` groups collapse into a "More actions" overflow menu **one
group at a time** as the container narrows, rather than wrapping or hiding
everything at once. A permanent button per action is not free, and the
overflow mirror is the step that is easiest to forget.

Files: `web/src/app/components/split-grid.html` and `split-grid.ts`.

## 1. Decide: own button, or an option in a dropdown?

If the new action is a close variant of an existing one — a second export
format, a second thing to reorder, a second thing to add — it does **not** get
its own button. It becomes an option in a `.toolbar-menu` dropdown on the
existing button, which grows a caret.

Existing precedents: Export (Save as JSON / Save as PNG), Reorder (Sheets /
People), Add (Sheet / Person).

Match the option style to what the options mean:

- **Iconed** options read as different destination formats — Export.
- **Plain-text** options read as the same kind of thing applied to a different
  entity — Add, Reorder.

## 2. Pick the cluster

Add the button inside one of the four `.toolbar-cluster` groups, by how
essential it is — the higher-numbered clusters collapse into the overflow menu
first. Keep the `#cluster` marker on the one real box in the group; the divider
survives `display: contents`, and `toggleOverflowMenu` uses that marker to tell
which groups are currently hidden.

## 3. If it is a dropdown, copy the anchor pattern

Each menu is an anchor signal on the host plus a toggle/close pair:

```ts
protected readonly exportMenuAnchor = signal<{ x: number; y: number } | null>(null);

protected toggleExportMenu(event: MouseEvent): void {
  if (this.exportMenuAnchor()) {
    this.closeExportMenu();
    return;
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  this.exportMenuAnchor.set({ x: rect.left, y: rect.bottom + 4 });
}

protected closeExportMenu(): void {
  this.exportMenuAnchor.set(null);
}
```

In the template, the menu is a `.toolbar-menu-backdrop` plus a `.toolbar-menu`
positioned from the anchor. Add the new `close…Menu()` call to the host
listener that closes every menu at once, so opening one dismisses the others.

## 4. Mirror it into the overflow menu

**This is the step that gets missed.** Add the same action to the overflow
menu block, inside the `@if (overflowedClusters().has(N))` branch for the
cluster you chose. A dropdown is mirrored as a button carrying a
`menu-submenu-caret` rather than the toolbar's own caret.

Check the `toolbar-menu-divider` conditions between groups still read
correctly with your addition present.

## 5. Re-check the breakpoints

The container-query breakpoints above `.toolbar-cluster` are tuned to actual
measured widths. Adding a button changes what fits.

Do not force an extreme width and read `scrollWidth` to find the boundary —
flex-shrink makes that lie. Bisect near the real boundary instead.

## 6. Verify

```bash
cd web && npm run build
```

Required, not optional: `split-grid.ts` has the largest component styles in the
project and is closest to the per-component CSS budget, which **only** the
build enforces.

Then run the suite, and use the `verify-ui-change` skill if the change needs to
be proven visually:

```bash
cd web && npx ng test --watch=false --browsers=ChromeHeadless
```
