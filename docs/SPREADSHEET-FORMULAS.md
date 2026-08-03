# Spreadsheet formula reference

Every formula, named range, validation rule and conditional format in
`Expenses.xlsx`, with what it does and where the equivalent lives in the app.

The complete machine-readable dump is
[`workbook-export.json`](workbook-export.json), regenerated with:

```bash
python tools/export_workbook.py Expenses.xlsx docs/workbook-export.json
```

> **A note on the export.** The file is a Google Sheets workbook saved as
> `.xlsx`. Formulas that OOXML cannot express survive only as
> `IFERROR(__xludf.DUMMYFUNCTION("<real formula>"), <last cached value>)`.
> Excel opening this file shows the cached value and nothing else — the logic is
> in that string. The export script unwraps them; the formulas quoted below are
> the recovered originals.

---

## 1. Sheet layout

| Sheet | State | Role |
| --- | --- | --- |
| `Split` | visible | The output. Every item from every expense sheet, one column per person, balances on top. |
| `People` | visible | Names, column A. B1 holds a JSON snapshot the script maintained. |
| `Expenses` | visible | The first expense sheet. Users renamed and duplicated this. |
| `Currencies` | hidden | 183-row currency catalogue (A:C) and a code → units-per-USD rate table (I:J). |
| `3D8DE36231C` | hidden | The template cloned by "Add Sheet". The opaque name keeps it out of the way. |

Row offsets that matter: on both the Split sheet and every expense sheet, data
starts at **row 10**. Rows 1–9 are headers, totals and hidden machinery.

---

## 2. Named ranges and LAMBDAs

The workbook defines 21 names. Nine are workbook-scoped LAMBDA functions —
user-defined functions written in the formula language.

### Structural helpers

```
SPLITSHEET_COL   = LAMBDA(cols, Offset(cols, 9, 0, Rows(cols) - 9))
EXPENSESHEET_COL = LAMBDA(cols, Offset(cols, 9, 0, Rows(cols) - 9))
```

"Skip the nine header rows and give me the data part of this column." Both
bodies are identical; the two names exist for readability at the call site.
Nearly every aggregate on the Split sheet is wrapped in one of them.

*App equivalent:* not needed. Items are a list, so there are no header rows to
skip.

```
EXPAND_TO_LAST_ROW      = LAMBDA(range, Offset(range, 0, 0, Rows(Split!$A:$A) - Row(range) + 1))
EXPAND_TO_LAST_NAME_COL = LAMBDA(arg, LET(
  c, COLUMN(arg),
  w, MAX(IF(LEN(Split!$M$7:$7), COLUMN(Split!$M$7:$7) - c + 1)),
  OFFSET(arg, 0, 0, , If(w = 0, 1, w))
))
LAST_ROW = LAMBDA(range, ArrayFormula(max(if(len(range), row(range)))))
ADD_EMPTY_ROW = LAMBDA(array, {MAKEARRAY(1, Columns(array), LAMBDA(r, c, )); array})
```

Dynamic range sizing: grow a range to the last used row, or to the last person
column (names start at `M7`). `ADD_EMPTY_ROW` prepends a blank row so a spilled
array lands one row lower than where its formula sits.

*App equivalent:* array `.length`.

### Sheet discovery

```
GETSHEETNAMES = LAMBDA(formularange, include_zero_totals, LET(
  txt,        FORMULATEXT(formulaRange),
  inside,     REGEXEXTRACT(txt, "sheetNames\s*,\s*\{([^\}]+)\}"),
  parts,      SPLIT(inside, ","),
  sheetNames, ARRAYFORMULA(Substitute(REGEXREPLACE(TRIM(parts), "^'|'?!A1$", ""), "''", "'")),
  TRANSPOSE(IF(include_zero_totals, sheetNames,
    IfError(FILTER(sheetNames, MAP(sheetNames, LAMBDA(s, INDIRECT(s & "!Total") > 0))), )))
))
```

This one deserves a moment. Sheets has no "list the tabs" function, so the
workbook **reads its own source code**: it takes the text of the aggregation
formula in `Split!D9`, regex-extracts the sheet names hard-coded in it, and
strips the quoting. The list of expense sheets is therefore whatever the Apps
Script last wrote into that formula.

*App equivalent:* `trip.sheets`.

### JSON serialisation

```
JSON_ESCAPE = LAMBDA(text, SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(
  text, "\", "\\"), """", "\"""), CHAR(10), "\n"), CHAR(13), "\r"), CHAR(9), "\t"))

JSON_PROP = LAMBDA(name, value, wrapinquotes, IF(wrapInQuotes,
  """" & JSON_ESCAPE(name) & """:""" & JSON_ESCAPE(value) & """",
  """" & JSON_ESCAPE(name) & """:" & TO_TEXT(value)))

GET_SHEET_RANGE = LAMBDA(name, ...)   -- returns "[firstRow,lastRow]" for a sheet
```

A JSON encoder written in spreadsheet formulas. `Split!L5` uses these to
serialise the whole workbook state into a single string that the Apps Script
reads. See [MACROS-AND-AUTOMATION.md](MACROS-AND-AUTOMATION.md) §3.

*App equivalent:* the `Trip` object itself.

### Value aliases

| Name | Points at | Meaning |
| --- | --- | --- |
| `Title` | `Split!$D$1` | Trip title, kept in sync with the file name. |
| `SelectedMainCurrencyAbbr` | `Split!$G$2` | Base currency code, regex-extracted from the dropdown text. |
| `SelectedMainCurrencySymbol` | `Split!$H$2` | Its symbol. |
| `EffectiveMainCurrencySymbol` | `Split!$J$2` | The symbol actually applied to the cells — differs from the above while a currency change is still propagating. |
| `<sheet>!Total` | `<sheet>!$C$3` | That sheet's total. |
| `<sheet>!ExplicitPayers` | `<sheet>!$C$4` | That sheet's "Paid By", comma-separated. |
| `<sheet>!EffectiveCurrencySymbol` | `<sheet>!$F$1` | Symbol parsed back out of the formatted total. |

`EffectiveCurrencySymbol` at workbook scope is `#REF!` — a leftover from a
deleted sheet. Harmless, since only the sheet-scoped copies are used.

---

## 3. Expense sheet formulas

Each expense sheet is a small self-contained calculator. Layout:

| Row | A | B | C | D | E | F |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | "Currency:" | | currency name | code | symbol | effective symbol |
| 2 | rate state | fallback rate | **exchange rate** | is-default flag | | rate row hidden? |
| 3 | "Total:" | | **total** | | | error flag |
| 4 | "Paid By:" | | **payers** | | | row-count tripwire |
| 5–7 | labels | | **tax / tip / discount** | ×rate | resolved amount | |
| 8 | "Item" | | "Amount" | | | |
| 10+ | **item name** | | **item amount** | tax+tip−disc slice | amount ×rate | |

Bold cells are the ones a user edits.

### Currency and rate

```
C1  (dropdown)  currency name, validated against Currencies!F:F
D1:E1  =If(D2, {SelectedMainCurrencyAbbr, SelectedMainCurrencySymbol},
              XLookup(C1, Currencies!A:A, Currencies!B:C))
D2     =C1 = Currencies!A1                     -- A1 holds the literal "Default"
B2:C2  ={"", If(D2, 1,
              IfError(1 / XLookup(D1, Currencies!I:I, Currencies!J:J),
                      Exchange_Rate(D1, SelectedMainCurrencyAbbr, Today())))}
A2     =IF(IsError(B2), 2, 1)
F2     =Not(SUBTOTAL(103, E2))                 -- is the rate row hidden?
```

`C2` is the applied rate. Reading `B2:C2`: default-currency sheets are pinned to
`1`; otherwise take the rate from the cached `Currencies!I:J` table, and only
call the live `Exchange_Rate` function if that lookup fails. A comment on `B2`
explains why: *"Implements fallback mechanism, since sometimes the custom
function in currencies sheet doesn't load correctly and gets stuck on
Loading…"*.

The user overwrites `C2` to pin a rate. Because that replaces the array formula,
`B2` collapses to `#REF!`, and `A2` reads that error as the "pinned" state — an
error deliberately used as a flag.

*App equivalent:* `sheetRate()`, `isRatePinned()` in `split-engine.ts`.

### Totals

```
C3     =Round(Sum(EXPENSESHEET_COL(C:C)) + E5 + E6 - E7, 2)

E5:E6  =ARRAYFORMULA(LET(vals, $C5:$C6, txt, TO_TEXT(vals),
                         total, SUM(EXPENSESHEET_COL(C:C)),
                         IF(REGEXMATCH(txt, "%"), vals * total, vals)))

E7     =LET(val, $C7, txt, TO_TEXT(val), total, SUM(EXPENSESHEET_COL(C:C)),
            amount, IF(REGEXMATCH(txt, "%"), val * total, val),
            Min(total, amount))

D5:D7  =E5:E7 * $C$2
```

The amount-or-percentage rule is implemented by inspecting the cell's **text**
for a `%`. `E7` is where the discount cap lives (`Min(total, amount)`).

*App equivalent:* `resolveCharge()` and `computeSheetTotals()`; rule R5.1–R5.3.

### Per-item conversion

```
E9:E19  =If(IsBlank(C9:C19), , C9:C19 * $C$2)

D9:D19  =If(IsBlank($C$9:$C19) + ($C$9:$C19 = 0), ,
            Let(itemSum, SUM($C$9:$C19),
                if(itemSum = 0, 0,
                   (($D$5 + $D$6 - MIN(itemSum, $D$7)) / itemSum) * $C$9:$C19 * $C$2)))
```

`D` is the item's proportional slice of tax + tip − discount, in base currency.
Note `(charge / itemSum) × itemAmount` — proportional to price, which is rule
R5.4.

*App equivalent:* `chargePerUnit` in `buildRows()`.

### The error flag

```
F3  =OR(
      OR(ARRAYFORMULA(COUNTIF(Indirect("$A$8:$A"), $A10:$A19) > 1)),        -- duplicate item
      OR(ARRAYFORMULA(((Not(IsBlank($A10:$A19))) * (IsBlank($C10:$C19))) > 0)), -- named, unpriced
      OR(ARRAYFORMULA(((IsBlank($A10:$A19)) * (Not(IsBlank($C10:$C19)))) > 0)), -- priced, unnamed
      COUNTIF(INDIRECT("Currencies!F:F"), C1) = 0,                          -- unknown currency
      (((C4 <> "") * (SUMPRODUCT(COUNTIF(INDIRECT("People!A2:A"),
         TRIM(SPLIT(SUBSTITUTE(C4, """", ""), ","))) = 0) > 0)) > 0))       -- unknown payer
```

One boolean summarising every problem on the sheet, so the Split sheet can ask a
single question per sheet instead of re-deriving all of them.

*App equivalent:* `sheetIssues()` in `validation.ts`, which reports the
individual causes rather than collapsing them.

`F4 = CountA(A10:A100000001)` is not used by anything. Its comment says *"This
serves to force trigger edit event on row deletion"* — a dependency planted
purely so Sheets fires `onEdit` when rows are removed.

---

## 4. Split sheet formulas

Layout: `A` sheet name · `B` tax/tip caption · `C` back-references · `D` item ·
`E` amount · `F` charge slice · `G` unit paid · `H` unit cost · `I` pay units ·
`J` cost units · `K`–`L` change detection · `M`+ one column per person.

### Aggregating the expense sheets

```
D9  =ADD_EMPTY_ROW(Let(
       sheetNames, {'3D8DE36231C'!A1, Expenses!A1},
       range0, Let(lastRow, LAST_ROW(EXPENSESHEET_COL('3D8DE36231C'!A:A)),
                   If(lastRow > 0, ChooseCols(Index('3D8DE36231C'!A:A, 10)
                                              :Index('3D8DE36231C'!E:E, lastRow), 1, 5, 4), )),
       cond0,  IfError('3D8DE36231C'!Total > 0, FALSE),
       array0, {ARRAYFORMULA(SEQUENCE(ROWS(range0), 1, 1, 0) * 0 + cond0 = 1), range0},
       ... one block per sheet ...
       s, VSTACK(array0, array1),
       kept, FILTER(s, CHOOSECOLS(s, 1)),
       result, CHOOSECOLS(kept, 2, 3, 4), ...))
```

`ChooseCols(..., 1, 5, 4)` picks columns A, E, D — item name, converted amount,
charge slice — which become Split columns D, E, F. Sheets with a zero total are
filtered out.

This formula is **rewritten by the Apps Script** whenever a sheet is added,
removed or reordered, and `GETSHEETNAMES` reads the sheet list back out of its
own text.

*App equivalent:* `buildRows()` — a loop over `trip.sheets`.

### Unit costs

```
I9  =LET(rows, BYROW(ARRAYFORMULA(EXPAND_TO_LAST_NAME_COL(SPLITSHEET_COL(M:M))),
      LAMBDA(splitRow, LET(
        payRatios, ARRAYFORMULA(MOD(splitRow, 1) * 10),
        billSheetName, REGEXEXTRACT(INDEX($C:$C, ROW(splitRow)), "^[^!]+"),
        explicitAssignments, INDIRECT(billSheetName & "!ExplicitPayers"),
        IF(ISERROR(billSheetName), ,
           IF(ISBLANK(explicitAssignments), SUM(payRatios),
              COUNTA(SPLIT(explicitAssignments, ","))))))),
      total, SUM(rows), VSTACK(total, rows))

J9  =ADD_EMPTY_ROW(BYROW(EXPAND_TO_LAST_NAME_COL(SPLITSHEET_COL(M:M)),
      LAMBDA(rw, Let(result, Sum(Trunc(rw)),
        if(AND(result > 0, Not(IsBlank(Indirect("E" & Row(rw))))), result, )))))

G9  =ADD_EMPTY_ROW(iferror(if(SPLITSHEET_COL($E:$E) = "", ,
        (SPLITSHEET_COL($E:$E) + SPLITSHEET_COL($F:$F)) / SPLITSHEET_COL($I:$I)), 0))

H9  =ADD_EMPTY_ROW(Let(colE, SPLITSHEET_COL($E:$E), sum, SPLITSHEET_COL($F:F) + colE,
        if(sum = 0, , (sum / SPLITSHEET_COL($J:$J)))))
```

- `I` — pay units. Sheet-level payers win over per-cell ratios (rule R4.1).
- `J` — cost units, `Σ TRUNC(cell)`.
- `G` — `lineTotal / payUnits`, `H` — `lineTotal / costUnits`.

`H` divides by zero when a row has no shares. That `#DIV/0!` is not a bug; it is
how "missing share values" is detected downstream.

**This is where the `owe.pay` encoding is defined:** `TRUNC(cell)` is the owe
ratio, `MOD(cell, 1) * 10` is the pay ratio.

*App equivalent:* `SplitRow` in `split-engine.ts`.

### Balances

```
M5  =ArrayFormula(ROUND(BYCOL(EXPAND_TO_LAST_NAME_COL(M7:M17), LAMBDA(col, LET(
      header, INDEX(col, 1),
      IF(header = "", , LET(
        splits, OFFSET(col, 3, 0),
        explicitAssignments, Map(SPLITSHEET_COL($C:$C),
          Lambda(it, Indirect(REGEXREPLACE(it, "F\d+$", "ExplicitPayers")))),
        SUM(SPLITSHEET_COL($H:$H) * TRUNC(splits)
            - SPLITSHEET_COL($G:$G) * IF(IsBlank(explicitAssignments),
                MOD(splits, 1) * 10,
                Map(explicitAssignments, Lambda(eAssignment,
                  IF(COUNTIF(TRIM(SPLIT(eAssignment, ",")), header) > 0, 1, 0)))))))))), 3))
```

The core of the whole workbook, and it is one expression:

```
balance = Σ ( unitCost × owe − unitPaid × payRatio )
```

with `payRatio` switching between the cell's own decimal and sheet-level
membership. Rounded to 3 decimals.

*App equivalent:* `computeRawBalances()`; rule §7.2.

### The ±0.01 reconciliation

```
M2  =ARRAYFORMULA(LET(
      headers, EXPAND_TO_LAST_NAME_COL(M7), groupsRaw, EXPAND_TO_LAST_NAME_COL(M6),
      balancesRaw, EXPAND_TO_LAST_NAME_COL(M5),
      ...
      balances, ROUND(balancesRaw, 2), groups, groupsRaw, step, 0.01,
      isPaidBySpecified, SUM(SPLITSHEET_COL(I:I)) > 0,
      errTotal, IF(isPaidBySpecified, SUM(balances), SUM(balances) - $A2),
      baseCandidates, FILTER(TRIM(People!B:B), TRIM(People!B:B) <> "",
                             ISNUMBER(MATCH(TRIM(People!B:B), headers, 0))),
      adj, MAP(headers, grp, LAMBDA(h, g, LET(
        groupHeaders,    FILTER(headers, grp = g),
        groupCandidates, FILTER(baseCandidates,
                           ISNUMBER(MATCH(baseCandidates, groupHeaders, 0)),
                           XLOOKUP(baseCandidates, headers, balances) <> 0),
        err, IF(isPaidBySpecified, SUM(FILTER(balances, grp = g)), errTotal),
        k,   MIN(ABS(ROUND(err / step, 0)), COUNTA(groupCandidates)),
        pos, IFERROR(MATCH(h, groupCandidates, 0), 1000000000),
        IF(err = 0, 0, IF(pos <= k, -SIGN(err) * step, 0))))),
      ROUND(balances + adj, 2)))
```

Two targets, chosen by `isPaidBySpecified`: net to zero when payers exist,
otherwise net to the trip total (rules R7.1/R7.2). `k` people absorb one cent
each.

The candidate order comes from `People!B:B` — **not** column A, which holds the
names. Column B is a *shuffled* copy the script maintained, which is how the
guide's "randomly assigning ±0.01" was implemented.

*App equivalent:* `applyRoundingCorrection()`. See
[PORTING-NOTES.md](PORTING-NOTES.md) §2 for why the app does this
deterministically.

### Settlement groups

```
M6  =Transpose(LET(rng, EXPAND_TO_LAST_NAME_COL(M5),
      IF(AND(Counta(rng) > 2, SUMPRODUCT(N(ISERROR(rng))) = 0, Sum(SPLITSHEET_COL(I:I)) > 0),
         GetAssignedTransactionGroups(rng), )))
```

`GetAssignedTransactionGroups` is an Apps Script custom function; its body is
not in the file. Guards: more than two people, no errors, at least one payer.
It returns a group number per person, and the Split sheet has conditional
formats for groups 1–7.

*App equivalent:* `assignTransactionGroups()` in `settlement.ts`.

### Grand total and the status message

```
A2  =Round(Sum(SPLITSHEET_COL($E:$F)), 2)

H3  =AND(I9 > 0, COUNTIFS(SPLITSHEET_COL($I:$I), "=0", SPLITSHEET_COL($F:$F), "<>") > 0)

A3  =LET(
      isBaseCurrencyMissing,       IsBlank(E2),
      isAddingNewCheckSheet,       Not(IsBlank($A$8)),
      isChangingCurrency,          H2 <> EffectiveMainCurrencySymbol,
      noneNames,                   COUNTA(SPLITSHEET_COL($C:$C)) = 0,
      itemPriceMissing,            COUNTIFS(SPLITSHEET_COL($D:$D), "<>",
                                            SPLITSHEET_COL($E:$E), "=") > 0,
      payerAlreadyInCheck,         ... ,
      paidByMissing,               H3,
      shareValuesMissing,          CountIf(ArrayFormula(ERROR.TYPE($H13:H17) = 2), true) > 0,
      SWITCH(TRUE,
        isBaseCurrencyMissing, "Select a Base Currency",
        isAddingNewCheckSheet, "⏳ Adding new Expense Sheet...",
        isChangingCurrency,    "⏳ Changing Currency Symbol...",
        noneNames,             "✏️Start with the People sheet & the Expenses sheet",
        itemPriceMissing,      "Item(s) Amount Missing",
        payerAlreadyInCheck,   "Payer(s) already specified in Expense Sheet",
        shareValuesMissing,    "Missing Share Values",
        paidByMissing,         "Missing Payer for Item(s)",
        ""))
```

`shareValuesMissing` tests `ERROR.TYPE(H) = 2`, i.e. `#DIV/0!` — the deliberate
division by zero from `H9`. `H3` is rule R4.2: some rows have payers, others
don't.

*App equivalent:* `tripIssues()` in `validation.ts`, same priority order. The
two `⏳` states have no counterpart — they existed because Apps Script ran
asynchronously.

---

## 5. Data validation

| Sheet | Range | Rule | App equivalent |
| --- | --- | --- | --- |
| Split | `M11:V17` | decimal, 0 – 10 | share input `min`/`max`, `onShare()` |
| Split | `E2` | list from `Currencies!D2:D17` | base-currency `<select>` |
| Expense | `C10:C19` | `AND(ISNUMBER(C10), C10 >= 0)` | `NEGATIVE_AMOUNT` |
| Expense | `C2` | `If(D2, C2 = 1, C2 > 0)` — *"Invalid exchange rate. Enter a positive value, or exchange rate can only be 1"* | `INVALID_RATE`, R6.2 |
| Expense | `C1` | list from `Currencies!F:F` | currency `<select>` |
| Expense | `C4` | list from `People!A2:A19` — *"Only names in the People sheet can be selected."* | Paid By checkboxes |

Note the ceiling implied by `M11:V17`: columns M through V is **ten people**.
The app has no such limit.

---

## 6. Conditional formatting

22 rules on the Split sheet, 8 per expense sheet. The ones that carry meaning
rather than decoration:

```
-- Cell tinted: this person paid for this row
Let(explicitAssignment, INDIRECT(REGEXREPLACE($C9, "F\d+$", "ExplicitPayers")),
    AND(OR(AND(IsBlank(explicitAssignment), MOD(M9, 1) <> 0),
           CountIf(ArrayFormula(Trim(Split(explicitAssignment, ","))), M$7) > 0), ...))

-- Row red: no shares assigned (the #DIV/0! from H9)
AND(IsError($H9), ERROR.TYPE($H9) = 2, ...)

-- Row red: payers exist elsewhere but not here
AND(Not(IsBlank($F9)), $I$9 <> 0, $I9 = 0, Trim($D9) <> "", ...)

-- Cell red: per-item payment on a sheet that already declares payers
Let(explicitAssignment, INDIRECT(REGEXREPLACE($C9, "F\d+$", "ExplicitPayers")),
    AND(Not(IsBlank(M$7)), Not(IsBlank(explicitAssignment)), MOD(M9, 1) <> 0, ...))

-- Name header coloured by settlement group
M$6 = 1   ... through ...   M$6 = 7

-- Balance shown red (and in parentheses via number format) when negative
cellIs lessThan 0     on M2:V4
```

Every rule is duplicated for odd and even rows (`Mod(row(), 2)`) purely to
preserve the striping — the app does that with `:nth-child(odd)`.

*App equivalents:* `.share-cell.paid`, `.share-cell.missing`, `.group-dot`,
`MoneyPipe` (parentheses for negatives).

---

## 7. Cell comments

Six developer notes survive in the file. They document intent that no formula
can express:

| Cell | Comment |
| --- | --- |
| `Split!H3` | *"is payer missing"* |
| `Split!I3` | *"Sheets were changed and aggregate formula needs to be updated. This causes an onEdit to raise as well, when sheets are deleted, otherwise, no event would be raised."* |
| `Split!L4` | *"use only for conditional formatting, otherwise, use EXPAND_TO_LAST_NAME_COL"* |
| `Expense!B2` | *"Implements fallback mechanism, since sometimes the custom function in currencies sheet doesn't load correctly and gets stuck on Loading..."* |
| `Expense!F3` | *"If conditional formatting on any area are updated, uncomment the buildRedIndicator call in code to rebuild this formula based on them."* |
| `Expense!F4` | *"This serves to force trigger edit event on row deletion"* |

Four of the six are about fighting the platform rather than about splitting
costs. That ratio is the clearest argument in the file for moving off the
spreadsheet.
