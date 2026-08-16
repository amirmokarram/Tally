---
name: verify-ui-change
description: Prove a visual, layout or CSS change in the Tally report actually renders correctly, by asserting real geometry in real Chrome from a Jasmine spec. Use after changing styles, column widths, row heights, cell padding, the totals band, or anything else whose correctness is a rendered result rather than a value.
---

# Verify a UI change

A rendering fix is not proven by the diff, and it is not proven by describing
it. It is proven by reading the rendered geometry back.

Screenshots are not reliably available in this environment — the browser pane
does not composite, so a capture can come back empty or with a viewport of
0x0, and an overlay scrollbar hides real bugs. The verification path that
works here is a **Jasmine spec running in real Chrome**, which is also what CI
runs.

## 1. Find or add the spec

Specs live beside their source. For the report grid that is
`web/src/app/components/split-grid.spec.ts` (already large — add to the
relevant `describe`, do not start a new file).

Build the component through the existing `grid()` harness, which provides
`FakeStorage` for both `TRIP_STORAGE` and `SESSION_STORAGE` and hands back
`{ fixture, store, api }`.

## 2. Let the change actually land

Use the file's `settle()` helper after anything that writes a signal:

```ts
async function settle(fixture: ComponentFixture<SplitGrid>): Promise<void> {
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}
```

**A bare `await new Promise(resolve => setTimeout(resolve))` is not enough.**
In the live app zone.js runs `ApplicationRef.tick()` once the zone stabilizes,
so a signal write reaches a bound `@Input` on its own. TestBed does not — a
spec that only awaits a tick can pass by coincidence without the update ever
having landed.

## 3. Assert the rendered result, not the input

Read what the browser computed:

- `getComputedStyle(el)` for resolved values, and
  `getComputedStyle(el, '::after').content` for pseudo-elements — the existing
  specs use both to check focus rings and markers.
- `getBoundingClientRect()` for position and size.
- The `GridApi` for anything AG Grid owns — column state, row heights, spans.
  Ask the grid; do not recompute it from the model and assume they agree.

Assert the property that was actually wrong. If the report showed a drifting
totals band, assert the band's offset against the column it must line up with
— not merely that a CSS variable holds a new number.

One caveat on margins: `getBoundingClientRect()` will not reveal a collapsed
margin, because collapsing changes layout rather than the element's own
computed margin value. See `agent_docs/report-layout.md`.

## 4. Run it

```bash
cd web && npx ng test --watch=false --browsers=ChromeHeadless
```

Confirm the new spec fails against the old code if there is any doubt it is
testing the right thing.

## 5. If the change touched CSS, build too

```bash
cd web && npm run build
```

This is the only check that enforces the per-component style budget. The test
suite passes regardless of how large a component's styles get.

## Reporting

Quote the assertion and the run result. If something could not be verified this
way, say so plainly rather than implying it was checked.
