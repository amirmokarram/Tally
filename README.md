# Tally

A web app for splitting costs between friends, ported from a Google Sheets
workbook (`Expenses.xlsx`) and its user guide (`Help.pdf`).

Splitting a bill evenly is easy and most tools stop there. This one handles the
real case: people who consumed different amounts, and a different set of people
who actually paid. It turns those two facts into the shortest list of payments
that leaves everybody square.

```bash
cd web
npm install
npm start          # http://localhost:4200
npm test           # engine + component tests
npm run build
```

## Layout

```
web/                       Angular 20 application
  src/app/models/          Trip, Person, ExpenseSheet, Item, Share, SavedSplit
  src/app/core/            calculation engine, settlement, validation, store,
                           storage, multi-tab sync, file import/export
  src/app/data/            currency catalogue + rate snapshot, worked examples
  src/app/components/      Splits, Split (the ledger grid), Settle up, Help
docs/                      reverse-engineering and specification — start here
reference/                 the original workbook and its user guide
tools/export_workbook.py   dumps the source workbook to JSON
```

## One page, not three

People, expense sheets and the owe/pay grid used to be three tabs, which meant
entering a figure in one place and walking to another to see what it did. They
are now a single AG Grid ledger on the **Split** tab: people are the columns,
named from their headers; each expense sheet spans a block of rows, with its
currency, tax, tip, discount and payers behind a panel its cell opens; and the
blank row at the end of a block adds a line, numbered within its own sheet.

Two selections, because they answer different questions. **Tick** the box at the
start of a line to choose *lines* — removing them, giving everyone a share, or
clearing their shares are all buttons above the grid, acting on everything
ticked. **Drag** across cells to choose a *block* of values, then
<kbd>Ctrl/⌘ C</kbd> and <kbd>Ctrl/⌘ V</kbd>; one value pasted over a block fills
it, which is how a whole column of shares is set at once.

AG Grid **Community** only — MIT, no licence key. Nothing may import
`ag-grid-enterprise`, so two of its features are the app's own:

- **row grouping** → the sheet blocks are cell spanning (`enableCellSpan` +
  `spanRows`) over the flat row array built in `components/ledger-model.ts`;
- **range selection and clipboard** → the rectangle in `components/cell-range.ts`,
  driven from `components/split-grid.ts`, writing through the columns' own
  `valueSetter`s so a paste obeys exactly the rules typing does.

## The model in one page

- **People** take part in a **trip**. A trip has a base currency.
- Costs go on **expense sheets** — one per check or category. Each sheet has its
  own currency, its own tax / tip / discount, and its **items**.
- For each item, each person gets a **share**: how much they owe, and how much
  they already paid — both as ratios relative to the others on that row.
  `1 1 1` splits evenly, `1 3 4` splits an 8-slice pizza, `1.2` means "owes one
  share, paid two".
- Payment is recorded either **per sheet** (someone's card covered the whole
  check) or **per item** (everyone brought something different). Not both on the
  same sheet.
- Tax, tip and discount are spread across a sheet's items in proportion to
  price, then follow the same share ratios.
- **Balances** come out as `owed − paid`. They net to zero when payers are
  recorded, or to the trip total when nobody is. They always reconcile exactly.
- **Settlement** is normally everyone paying whoever is owed most. When the
  balances break into independent zero-sum groups, each settles internally and
  fewer payments are needed.

Full detail with numbered rules: [docs/BUSINESS-RULES.md](docs/BUSINESS-RULES.md).

## Architecture

The calculation is a pure function of the trip:

```
Trip ──► buildRows ──► computeRawBalances ──► assignTransactionGroups
                                          └─► applyRoundingCorrection ──► balances
                                                                      └─► buildTransfers
```

Nothing in `core/split-engine.ts` or `core/settlement.ts` imports Angular, so the
whole business model is testable in isolation and portable to a server if the
project ever needs one. `TripStore` holds a single signal and exposes everything
else as `computed()`, which is what replaces the spreadsheet's recalculation.

Splits are kept in a **library** — several saved at once, listed most recently
edited first, exactly as the spreadsheet gave you a file per trip in Drive. The
whole library is one `localStorage` document, persisted on every change and
restored on start-up. Which split a tab is *showing* lives in `sessionStorage`
instead, so two tabs can sit on different splits and each returns to its own
after a reload.

`Trip` is a plain serialisable object, so persistence is JSON in and JSON out —
the care is all in `core/library-storage.ts` and `core/trip-revive.ts`, which
treat what comes back as untrusted and validate it field by field rather than
casting. Structural damage rejects a document in favour of a clean start;
damage confined to one entry drops that entry. A single-split document from an
earlier build is migrated, never discarded.

Storage is injected through the `TRIP_STORAGE` and `SESSION_STORAGE` tokens,
feature-detected by probing — some privacy modes expose `localStorage` but throw
on write — and the UI says plainly when saving is unavailable or failing.

Open tabs are kept in step through the `storage` event. A change to a split the
tab is not showing is adopted silently; a change to the split it *is* showing is
adopted when the tab is idle, and held aside with a choice when the user is
mid-edit. Adopted changes are never written back, which is what stops two tabs
echoing the same library at each other forever.

Splits can be exported to a JSON file and imported back — the only way to back
them up, move them to another device, or send one to somebody, since there is no
server. Files and storage share one versioned envelope and one reader, so there
is a single format to validate. Import *adds* to the library rather than
replacing it, so it cannot destroy anything, and explains *why* a file was
rejected rather than failing generically.

The reasoning behind each of these is in
[docs/PORTING-NOTES.md §10](docs/PORTING-NOTES.md).

## Correctness

The four worked examples from the original guide are encoded as fixtures and
asserted against its published figures — sheet totals, per-person balances,
settlement groups and payment counts:

```bash
cd web && npm test
```

They are also loadable from the app's **Help** tab.

Where the app knowingly departs from the spreadsheet — the grand-total rounding,
the odd cent, group tolerance — each difference is stated with its reasoning in
[docs/PORTING-NOTES.md](docs/PORTING-NOTES.md).

## About the source workbook

Two things surprise people opening it:

- **It has no macros.** No VBA, no `vbaProject.bin`. The automation was Google
  Apps Script, which does not travel with an exported `.xlsx`.
- **Excel cannot show you most of its formulas.** Anything Google Sheets could
  express but OOXML could not was exported as
  `IFERROR(__xludf.DUMMYFUNCTION("<real formula>"), <cached value>)`. Excel shows
  the cached value; the logic is in the string.

`tools/export_workbook.py` unwraps all of it — formulas, named ranges, LAMBDAs,
data validation, conditional formatting and developer comments — into
[docs/workbook-export.json](docs/workbook-export.json).
