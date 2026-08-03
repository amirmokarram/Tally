# Porting notes

Where **Tally** deliberately differs from the spreadsheet, and why. Everything
not listed here is a faithful port — the four worked examples from the original
guide are asserted to the cent in `split-engine.spec.ts`.

---

## 1. Grand total: sum of sheet totals, not sum of raw columns

**Spreadsheet:** `Split!A2 = Round(Sum(SPLITSHEET_COL($E:$F)), 2)` — the sum of
every unrounded per-item column.

**App:** the sum of each sheet's own rounded total.

The two can differ by a cent. The guide's own "Trip to New England" example is a
case in point: the four sheets display 1073.56 + 88.01 + 114.06 + 150.24 =
**1,425.87**, while the unrounded columns add up to 1,425.875, which rounds to
1,425.88. The screenshot shows 1,425.87, so even the original was displaying the
figure its own formula would not produce.

A total that a user can verify by adding up what is on screen is worth more than
one that is a hair more precise, so the app adds up the visible numbers.

---

## 2. The odd cent is assigned deterministically

**Spreadsheet:** the reconciliation pass in `Split!M2` picks candidates from
`People!B:B` — a *shuffled* copy of the names maintained by the Apps Script. The
guide describes this as "randomly assigning ±0.01 to the individuals when
needed".

**App:** candidates are taken in people-list order.

Randomising is defensible as a fairness argument, but in a live-recalculating UI
it means figures shuffle on every keystroke, and it makes the output
irreproducible. The app takes the first non-zero people in list order instead.
The arithmetic is identical and the column still reconciles exactly; only the
recipient of the odd cent differs.

This is the one place where the app knowingly produces a different number from
the guide's screenshots. The tests assert the raw balances match to better than
a cent and that the final figures are within exactly one cent, rather than
pretending the original was reproducible.

---

## 3. Rounding is decimal-exact

`13.515 × 100` is `1351.4999999999998` in IEEE-754, so the naive
multiply-and-round gives `13.51` where the spreadsheet gives `13.52` — and
13.515 is exactly what a 15% tip on 90.10 produces.

`round()` applies the decimal shift through the number's string form, which
keeps it exact, and rounds half away from zero to match `ROUND()`.

---

## 4. Settlement groups tolerate rounding, and require both signs

Two changes to the group-partitioning contract, both forced by working with
rounded inputs:

- **Tolerance.** Balances arrive rounded to three decimals, so a genuinely
  independent group rarely sums to exactly zero. The guide's own
  debt-simplification example has groups summing to ±0.004. A subset is accepted
  when its total is within half a cent per member; the ±0.01 pass then forces it
  to zero exactly. Without this the partition search finds nothing and the
  feature silently never fires.
- **Both signs required.** A group must contain at least one debtor and one
  creditor. Otherwise a single person with a near-zero balance qualifies as a
  "group" of one, which is meaningless — there is nobody to settle with.

---

## 5. Payments are listed, not described

The spreadsheet stopped at the balance row and left settlement to prose in the
guide. Since the grouping already establishes which subsets settle
independently, `buildTransfers()` produces the actual list: largest debtor pays
largest creditor, repeatedly, within each group. A group of `m` clears in at
most `m − 1` payments.

---

## 6. Limits removed

| | Spreadsheet | App |
| --- | --- | --- |
| People | 10 (`M11:V17`) | unbounded |
| Items per sheet | 10 (`C10:C19`) | unbounded |
| Expense sheets | practical only | unbounded |
| Settlement groups | 7 (conditional formats) | unbounded; colours cycle after 7 |

---

## 7. Validation reports causes, not a flag

`Expense!F3` collapsed five different problems into one boolean, and `Split!A3`
showed a single message for the whole workbook. The app keeps the same priority
order but reports each problem individually, naming the item involved, and
highlights the offending row. It also adds three checks the original had no way
to express: negative amounts, unknown payers left behind by a removed person,
and a discount that had to be capped.

---

## 8. Removed entirely

The following existed only to work around Google Sheets and have no counterpart:

- state synchronisation (`Split!L5` JSON export and everything that consumed it);
- staleness detection and formula rewriting (`Split!I3`, `Split!D9`);
- `onEdit` tripwires (`Expense!F4`, `Split!K8`, `Split!K9`, `Split!L9`);
- the "Add Sheet" checkbox and its ⏳ progress messages;
- the hidden `3D8DE36231C` template sheet;
- range protection;
- sheet-name string parsing (`GETSHEETNAMES` reading a formula's own text).

See [MACROS-AND-AUTOMATION.md](MACROS-AND-AUTOMATION.md) for what each did.

---

## 9. Not carried over

- **Live exchange rates.** Rates are a snapshot taken from the workbook's own
  `Currencies!I:J` table. Pinning a rate — already the recommended practice for
  anything that matters — works exactly as before.
- **Live collaboration.** The original inherited Google Drive's sharing: a link,
  and several people editing at once. A split can be exported to a file and sent
  on, but that is a copy, not a shared document. See §10.
- **Revision history.** Drive kept every version. Nothing does here.
- **Sync across devices.** Drive followed you between machines; a browser's
  storage does not.

---

## 10. Persistence

The trip is written to `localStorage` on every change and restored on start-up.
Three things about it are worth stating, because they are choices rather than
defaults:

**Restored data is untrusted.** Whatever comes back may be from an older build,
hand-edited in devtools, or truncated by a crashed write. `reviveTrip()`
validates and coerces field by field. Structural damage — people or sheets that
are not arrays — discards the document and starts clean; damage confined to one
entry drops that entry, so a single corrupt item does not cost the user
everything else.

**Referential damage is kept, not cleaned.** A `paidBy` naming somebody who no
longer exists survives the round trip, because `validation.ts` reports it as
`UNKNOWN_PAYER`. Silently deleting it would hide a real problem.

**Writes are synchronous and undebounced.** A trip is a couple of kilobytes, so
a write per keystroke costs less than the bookkeeping a debounce would need —
and it cannot lose the last edit before the tab closes.

Two consequences the UI states plainly rather than hiding: a browser that
refuses storage means the split will not survive a reload, and a failed write
(quota, revoked permission) raises a banner instead of failing silently.

Ids gained a random component at the same time. A counter alone restarts at zero
after a reload and would collide with ids already in storage.

### Multiple tabs

The `storage` event fires in every tab *except* the one that wrote, so it is a
usable change feed between tabs. Two problems have to be solved before it is
safe to act on.

**The echo.** Adopting a remote trip sets the state signal, which fires the
autosave effect, which writes — which the other tab sees as a remote change, and
so on. The fix is that the effect compares against `lastPersisted`, which
`adoptRemote()` sets *before* touching the signal. An adopted change is by
definition already in storage, so the write is skipped and the loop never
starts. The test for this first proves autosave is live, so it cannot pass by
accident.

**Clobbering.** Blindly adopting would delete whatever the user is part-way
through typing. The store therefore records when the last local edit happened
and branches:

- **No local edit in the last 15 seconds** → adopt silently, with a brief notice
  explaining why the screen changed. This is the ordinary case: one tab is being
  used, the others are idle and should follow.
- **Otherwise** → hold the incoming trip aside and raise a banner offering *use
  the other tab's* or *keep this one*. Nothing is lost until the user chooses;
  keeping the local version republishes it so the other tabs converge on it.

The window is a heuristic, and deliberately so. Deciding this properly means
tracking causal ancestry — a version vector per tab, or a merge — which is a
large amount of machinery for a tool where simultaneous editing of the same
split in two tabs is a mistake rather than a workflow. The heuristic is right in
the common cases and, where it is wrong, it errs toward asking rather than
discarding. A change older than the window has almost certainly been seen and
built upon by the other tab, so adopting it is a fast-forward, not a loss.

What this is *not* is collaboration. It is one person with two tabs open, kept
consistent. Two people editing needs a server.

### Export and import

A split can be written to a JSON file and read back. With no server, that file
is the only way to keep a backup, move a split to another device, or hand it to
somebody else — so the format is treated as an interface rather than a dump:

- **One envelope for both paths.** Storage and files use the same
  `{ app, version, savedAt, trip }` document, so there is one format to
  validate and one place to version it. `readDocument()` is the single reader.
- **Failures are explained.** Storage only needs to know *whether* a document
  parsed; a person choosing the wrong file needs to know *why*. `readDocument()`
  returns a reason — not JSON, not from this app, a newer format version, or a
  split this build cannot read — and the UI shows it verbatim.
- **Pretty-printed, and marked.** People open these files. The `app` field means
  a stray JSON file gets "that file was not exported from this app" instead of a
  confusing structural error.
- **Read defensively.** An imported file goes through the same `reviveTrip()` as
  restored storage, with the same rules: structural damage rejects the file,
  damage confined to one entry drops that entry.
- **The file is read before the user is asked to confirm.** There is no point
  making somebody confirm a destructive action for a file that turns out to be
  unreadable.

The document predating the `app` marker is still accepted, so a split saved by
an earlier build survives the upgrade.

### Several saved splits

The spreadsheet's unit of storage was a file in Drive, one per trip. The app's
equivalent is a **library**: every saved split in one document, listed most
recently edited first.

- **One document, one key.** Writes stay atomic, the multi-tab change feed stays
  a single `storage` key, and the format lives in one place. At a few kilobytes
  per split, rewriting the library on each edit costs less than the bookkeeping
  that splitting it across keys would need. The fix if a library ever grows
  enough for that to bite is a key per split plus an index — not a debounce.
- **The mutators never learned about it.** Every edit funnels through
  `TripStore.update()`, which maps a change to a `Trip` onto a change to the
  library. Adding the library touched that one method; the fifty-odd mutators
  above it are unchanged.
- **The library is never empty.** Deleting the last split leaves a fresh one, so
  `activeSplit()` is total and no downstream `computed` needs null handling.
- **Which split is active is per-tab**, held in `sessionStorage` rather than in
  the shared document. Two tabs can sit on different splits, and each returns to
  its own after a reload. It also sharpens the conflict rule: a remote change is
  only capable of disturbing the user if it touched *the split this tab is
  showing*. Another tab editing a different split now updates the library
  silently, with no banner and no notice.
- **Version 2, and version 1 is migrated.** The old single-split document is
  read, wrapped as one saved split, written under the new key, and the old key
  removed. Somebody with a saved split must not lose it to an upgrade.
- **Import adds rather than replaces.** With somewhere to put them, imported
  splits join the library instead of overwriting the current one, which removes
  the destructive-confirm entirely. Fresh ids are assigned so importing the same
  file twice gives two independent copies.

#### Searching the library

The list is searchable once there is more than one split. Two decisions worth
recording:

**It searches the contents, not just the name.** Plenty of splits keep the
default title, and people recall a split by what was in it — "the one with
Sarah", "that Peruvian place", "the trip with the plane tickets". So the query
runs over the title, the people, the expense sheet names and the item names.
Searching only titles would look tidy and answer almost nothing.

**Every match explains itself.** Matching on content the list does not display
would look arbitrary — a row appears for a query with no visible reason. Each
result therefore carries the fields that matched and shows them as small
labelled chips. A title match needs no explanation, so it gets none.

Terms are combined with AND, and each must be found *within a single field*, so
a term is never matched across the boundary between two unrelated names.
`normalizeForSearch()` folds case, Latin accents, Persian harakat and the
zero-width non-joiner — and maps the Arabic yeh and kaf onto their Persian
counterparts, which look identical but carry different code points. Without that
last mapping a name typed one way never finds the same name stored the other.

#### Ordering the library

Four orders — recently edited, recently added, name, largest total — each with a
fixed sensible direction rather than a separate ascending/descending toggle.
Nobody wants their splits oldest-first or cheapest-first often enough to justify
doubling the control. The choice is a durable preference, so it lives in
`localStorage` rather than the per-tab `sessionStorage` that holds the active
split, and an unrecognised stored value falls back to the default.

Search filters, then sorting orders what survived, so the two compose.

Two details that are easy to get wrong:

- **Names sort through `Intl.Collator`** with `numeric: true` and
  `sensitivity: 'base'`, so "Trip 2" precedes "Trip 10" and accents fold the
  same way the search folds them. A list that finds "José" under "jose" should
  not then file it somewhere unexpected.
- **Every comparison ends in a tiebreak.** Equal names fall back to recency,
  equal totals to name, equal timestamps to name. A list that reshuffles between
  two identical-looking renders is worse than one sorted badly — the same lesson
  `nextUpdatedAt` exists for.

Untitled splits sort last by name, whichever direction the names run: they are
the least identifiable, so the least likely to be what is being looked for.

#### A `<select>` bug this surfaced

Adding the sort control exposed a bug that had been sitting in the currency
pickers all along.

`[value]` bound on a `<select>` whose options come from `@for` is applied before
the options exist. It matches nothing, and the control silently falls back to
displaying its *first* option. The model stays correct — the base currency was
genuinely EUR and every total rendered in euros — but the picker read "USD".
Nothing breaks except what the user is looking at, which is exactly how a bug
like this survives.

The fix is `[selected]` on each option, which is order-independent. All three
selects — base currency, sheet currency, sort order — used it, and
`components/select-binding.spec.ts` covered each. Those tests were checked
against the broken markup first: reinstating `[value]` failed them with
`Expected 'USD' to be 'EUR'`.

The two currency selects have since become the picker below; the sort control
is the one that still relies on `[selected]`, and the spec still guards it.

#### The currency selects became a searchable picker

Nearly 200 currencies is more than a `<select>` can present. Scrolling is slow,
and the browser's type-ahead only jumps by first letter of the *label*, so
"forint" finds nothing and the Hungarian Forint has to be hunted for.

`components/currency-picker.ts` is the ARIA combobox pattern instead — a text
box that filters the list, arrows to move, Enter to take, Escape to back out.
Two rules give it the safety a `<select>` has for free:

- **The box is never the source of truth.** Closed, it always reads the code the
  model holds; an abandoned query — Escape, or clicking away — changes nothing.
- **A code match outranks a name match.** "eur" means the Euro, though a dozen
  names contain those letters. `core/currency-search.ts` ranks exact code, code
  prefix, name prefix, then name word, and folds case and accents through the
  same `normalizeForSearch` the library search uses.

The sheet picker's "Default (USD)" entry is an ordinary row in the same list, so
it is searchable too and needs no special case in the component.

#### `updatedAt` had to become a total order

Ordering by wall-clock milliseconds is not enough. Creating a split and
immediately editing another lands both in the same millisecond, and the list
order then depends on the sort's stability rather than on what the user did
last — which is exactly how it first went wrong. `nextUpdatedAt()` stamps each
edit with `max(now, newest + 1ms)`, keeping `updatedAt` an ordinary timestamp
while making it strictly increasing. `mostRecentFirst()` still breaks ties by
position, for timestamps this app did not assign — those from a file or an
older build.

### Compared to the spreadsheet

Google Drive gave the original a file per trip, sharing, revision history and
sync across devices, all for free. The library closes the first of those, and
export/import lets splits leave the machine they were made on. The rest is the
honest trade for having no server: no two people on one split, no history, no
sync — a file you move yourself.
