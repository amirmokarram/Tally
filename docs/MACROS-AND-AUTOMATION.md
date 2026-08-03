# Macros and automation

What the spreadsheet's automation layer did, reconstructed from the traces it
left behind, and what became of each responsibility in **Tally**.

---

## 1. There are no macros in the file

`Expenses.xlsx` contains **no VBA**. There is no `xl/vbaProject.bin`, and the
extension is `.xlsx` rather than `.xlsm` — a macro-enabled workbook could not
use it. The export script asserts this:

```json
"hasVbaMacros": false
```

The automation was **Google Apps Script**, which lives with the Google Sheets
document, not inside an exported `.xlsx`. Its source is therefore not
recoverable from the files provided.

What *is* recoverable is its complete interface. The script left a large,
unambiguous footprint in the formulas: three custom functions called by name,
a JSON state export written for it to consume, several cells that exist only as
its flags, and developer comments describing what it did. That footprint is
reconstructed below, and everything it did is accounted for in the app.

---

## 2. Custom functions

Three functions are called from formulas but defined nowhere in the file.

### `Exchange_Rate(from, to, date)` — `Currencies!I:J`, expense sheet `B2`

```
IfError(1 / XLookup(D1, Currencies!I:I, Currencies!J:J),
        Exchange_Rate(D1, SelectedMainCurrencyAbbr, Today()))
```

Fetches a rate from an external feed. The guide says rates "update about once a
day". The cached `Currencies!I:J` table is tried first and the live call is only
a fallback, because — per the comment on `B2` — the custom function sometimes
"gets stuck on `Loading…`".

**In the app:** `autoRate()` in `split-engine.ts`, reading the `UNITS_PER_USD`
snapshot captured from `Currencies!I:J` into `data/currencies.ts`. A bundled
snapshot, not a live feed. Users who need an exact rate pin one, which was
already the recommended practice.

### `EXCHANGE_RATE_TO(from, to, date)` — `Currencies!I1`

A second entry point, used once to self-test that the feed responds
(`EXCHANGE_RATE_TO(base, base, Today())` should be 1).

**In the app:** not needed.

### `GetAssignedTransactionGroups(balances)` — `Split!M6`

```
IF(AND(Counta(rng) > 2, SUMPRODUCT(N(ISERROR(rng))) = 0, Sum(SPLITSHEET_COL(I:I)) > 0),
   GetAssignedTransactionGroups(rng), )
```

The only genuinely algorithmic piece. Takes the balance row, returns a group
number per person. Everything about its contract is pinned down by its call
site and its consumers:

| Evidence | What it establishes |
| --- | --- |
| Guarded by `Counta(rng) > 2` | Pointless below three people. |
| Guarded by `Sum(payUnits) > 0` | Only meaningful once somebody has paid. |
| Guarded by no errors in `rng` | Never runs on half-entered data. |
| Conditional formats for `M$6 = 1 … 7` | Returns small positive integers; at most seven groups were anticipated. |
| Blank result leaves headers uncoloured | Returns nothing when grouping buys nothing. |
| `M2` sums balances per group and forces each to zero | **Groups are zero-sum subsets.** |
| Guide: *"If a smaller number of transactions is possible… Each group should settle debts within themselves"* | The objective is to maximise the number of subsets. |

That is a complete specification: *partition the people into the largest number
of subsets whose balances each net to zero.*

**In the app:** `assignTransactionGroups()` in `settlement.ts` — an exact
maximum-cardinality partition by dynamic programming over subsets, with a
bounded greedy fallback past sixteen people. Two refinements the original
appears not to have needed:

- a group must contain both a debtor and a creditor (rule R8.2), so a lone
  near-zero balance cannot become its own group;
- because the input is rounded to three decimals, subsets rarely sum to exactly
  zero; a tolerance of half a cent per member absorbs that (rule R8.3).

The app also does what the spreadsheet stopped short of and lists the actual
payments (`buildTransfers()`). The original left that to prose in the guide:
*"Everyone can pay Rich, and he will pay $2.35 to Chris."*

---

## 3. The state export: `Split!L5`

The script's input. A single cell builds a JSON document describing the whole
workbook, using the `JSON_ESCAPE` / `JSON_PROP` / `GET_SHEET_RANGE` LAMBDAs (see
[SPREADSHEET-FORMULAS.md](SPREADSHEET-FORMULAS.md) §2). Its cached value gives
the exact schema:

```json
{
  "mainCurrencySymbol": "$",
  "selectedMainCurrencySymbol": "$",
  "splitSheetTitle": "Copy of Blank",
  "maxRows": 17,
  "maxColumns": 22,
  "maxColWithData": 13,
  "isSheetsFormulaStale": false,
  "people": { "namesSnapshot": [], "currentNames": [] },
  "sheets": {
    "Expenses": {
      "name": "Expenses",
      "isDefaultCurrency": true,
      "effectiveCurrencySymbol": "$",
      "selectedCurrencySymbol": "$",
      "hasUserOverriddenRate": false,
      "isRateRowHidden": true,
      "hasRedFormattingActive": false,
      "currencyFormatRanges": ["C3", "C10:C", "C5", "C6", "C7"],
      "taxTipDiscValues": ["$0.00", "$0.00", "$0.00"],
      "splitSheetRows": null
    }
  }
}
```

Read as a work list, every field is the script asking "is anything out of sync?"

| Field | What the script did with it |
| --- | --- |
| `splitSheetTitle` | Renamed the Drive file to match, and vice versa. |
| `namesSnapshot` vs `currentNames` | Detected added, removed or renamed people; rebuilt the split grid's columns while preserving existing share values. |
| `isSheetsFormulaStale` | Rebuilt the aggregation formula in `Split!D9` after a sheet was added, deleted or reordered. |
| `selectedCurrencySymbol` vs `effectiveCurrencySymbol` | Rewrote number formats on `currencyFormatRanges` after a currency change. |
| `hasUserOverriddenRate` | Showed 📌 (pinned) instead of 🔄 (daily). |
| `isRateRowHidden` | Showed or hid the exchange-rate row. |
| `hasRedFormattingActive` | Surfaced a sheet's error state on the Split tab. |
| `splitSheetRows` | Mapped each expense sheet to its block of rows on the Split sheet. |
| `maxRows` / `maxColumns` / `maxColWithData` | Grew the grid as data was added. |

**In the app:** all of it is gone. There is no state to synchronise because
there is only one state — the `Trip` object — and the views are computed from
it. `computed()` replaces the entire dirty-checking protocol above.

---

## 4. Trigger machinery

Cells that exist only to make Google Sheets fire `onEdit` at the right moments,
or to let the script signal progress:

| Cell | Purpose |
| --- | --- |
| `Split!A7` = `If(I3, "Refresh", "Add Sheet")` | Label for the checkbox in `A8`. One control, two jobs, depending on whether the workbook is stale. |
| `Split!A8` | The checkbox. Non-blank means "the script is adding a sheet" and drives the ⏳ message in `A3`. |
| `Split!I3` = `OR(Map(GETSHEETNAMES(D9, TRUE), Lambda(it, IsError(Indirect(it & "!A2")))))` | Staleness detector. Its comment: *"Sheets were changed and aggregate formula needs to be updated. This causes an onEdit to raise as well, when sheets are deleted, otherwise, no event would be raised."* |
| `Split!K8` | "Processing row value changes" flag. |
| `Split!K9`, `Split!L9` | Compare each row's current share values against a stored copy, so the script can tell which rows a user actually touched. |
| `Expense!F4` = `CountA(A10:A100000001)` | Referenced by nothing. Comment: *"This serves to force trigger edit event on row deletion"* — a dependency planted solely to provoke an event. |
| `Expense!F3` | Aggregated error flag. Comment mentions a `buildRedIndicator` routine that regenerated this formula from the conditional-format rules. |
| `3D8DE36231C` (hidden sheet) | The template "Add Sheet" cloned. |

**In the app:** none of this has an equivalent. Angular signals propagate change
by construction, so there is nothing to poke, no staleness to detect, and no
progress to report.

---

## 5. Protection

The guide is emphatic that most cells are protected and that editing them
produces a warning to be cancelled — with one exception, deleting an expense
sheet, where the warning should be accepted. The exported `.xlsx` carries no
protected ranges; Sheets protection does not survive the export.

**In the app:** protection is structural. Derived values are rendered as text,
not as editable fields, so there is nothing to protect and no warning to train
users to ignore.

---

## 6. Known issues that disappear

The guide's final page lists five problems. Four are platform artefacts:

| Issue | Status |
| --- | --- |
| Undo needs repeating many times | Gone — no script rewriting cells behind the user. |
| First open takes ~10 s while the script initialises | Gone. |
| Deleting a sheet raises a spurious protection warning | Gone. |
| Reordering sheets needs a dummy edit to propagate | Gone — order is data. |
| Mobile: multi-select for Paid By unsupported; title lag; rare automation stalls | Gone — checkboxes and plain HTML. |

The fifth, that the spreadsheet could glitch on an unreliable connection, does
not apply either: nothing here talks to a network.
