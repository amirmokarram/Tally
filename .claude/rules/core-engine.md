---
paths:
  - "web/src/app/core/**"
  - "web/src/app/models/**"
---

# Engine and storage conventions

- `split-engine.ts` and `settlement.ts` are **pure** — no Angular import, no
  state, no I/O. `computeSplit(trip)` takes the whole trip and returns every
  derived number the UI shows. Keep it that way: it is why the business model
  is testable in isolation and portable to a server.
- Use the local `round()`, never `Math.round(x * 100) / 100`. It matches Google
  Sheets' ROUND — half away from zero — by shifting the decimal exponent
  through the number's *string* form. `13.515 * 100` is `1351.4999999999998`
  in IEEE-754, so the naive version returns the wrong cent.
- Anything read back from storage or from a file is **untrusted**. Validate it
  field by field; never cast. Structural damage rejects the whole document in
  favour of a clean start; damage confined to one entry drops that entry. See
  `trip-revive.ts` and `library-storage.ts`.
- Storage arrives through the `TRIP_STORAGE` and `SESSION_STORAGE` injection
  tokens, feature-detected by probing — some privacy modes expose
  `localStorage` but throw on write. Never reach for `window.localStorage`
  directly.
- `Trip` stays a plain serialisable object: no classes, no methods, no `Date`
  instances on the model. Persistence is JSON in and JSON out.
- Files and storage share one versioned envelope and one reader, so there is a
  single format to validate. Add to that envelope rather than introducing a
  second shape.
- Each exported step names the workbook cell it replaces in its doc comment.
  A new rule also gets a numbered entry in `docs/BUSINESS-RULES.md`.

## Tests

`split-engine.spec.ts` asserts the four worked examples from the original
`Help.pdf` against its published figures. If one fails, the engine has diverged
from the spreadsheet — fix the engine. Never adjust an expected number to make
a test pass.

Where the app knowingly departs from the spreadsheet — grand-total rounding,
the odd cent, group tolerance — the difference belongs in `docs/PORTING-NOTES.md`
with its reasoning.
