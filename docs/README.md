# Documentation

Reverse-engineering of the Split Spreadsheet (`Expenses.xlsx` + `Help.pdf`) and
the specification of **Tally**, the Angular app that replaces it.

Tally splits a bill by what each person actually had rather than by headcount,
keeps track of who paid for it, and turns the two into the shortest list of
payments that leaves everybody square. It runs entirely in the browser, saves
there, and has no accounts.

Read in this order:

| Document | What it covers |
| --- | --- |
| [BUSINESS-RULES.md](BUSINESS-RULES.md) | **Start here.** The domain: entities, share ratios, money flow, balances, settlement, validation. Stated independently of any implementation. Every rule is numbered and referenced from the code. |
| [SPREADSHEET-FORMULAS.md](SPREADSHEET-FORMULAS.md) | Every formula, named range, LAMBDA, validation rule, conditional format and developer comment in the workbook — recovered, explained, and mapped to the code that replaces it. |
| [MACROS-AND-AUTOMATION.md](MACROS-AND-AUTOMATION.md) | The Apps Script layer: what it did, reconstructed from the traces it left, and what happened to each responsibility. |
| [PORTING-NOTES.md](PORTING-NOTES.md) | Every deliberate difference between the app and the spreadsheet, with the reasoning. §10 covers persistence. |
| [workbook-export.json](workbook-export.json) | Machine-readable dump of the whole workbook. Regenerate with `python tools/export_workbook.py reference/Expenses.xlsx docs/workbook-export.json`. |

## Two things worth knowing up front

**There are no macros.** The file is `.xlsx` with no `vbaProject.bin`. The
automation was Google Apps Script, which does not travel with an exported
workbook. Its source is unavailable; its complete interface is reconstructed in
[MACROS-AND-AUTOMATION.md](MACROS-AND-AUTOMATION.md) from the three custom
functions it exposed, the JSON state contract it consumed, and the flag cells it
drove.

**Most formulas are hidden from Excel.** The workbook was authored in Google
Sheets. Anything Sheets could express but OOXML could not was exported as
`IFERROR(__xludf.DUMMYFUNCTION("<the real formula>"), <last cached value>)`.
Open the file in Excel and you see cached values — the logic is inside those
strings. `tools/export_workbook.py` unwraps them.

## Verification

The four worked examples from the original user guide are encoded as data in
`web/src/app/data/sample-trips.ts` and asserted against the guide's
published figures in `web/src/app/core/split-engine.spec.ts`:

```bash
cd web && npm test
```

They are loadable from the app's Help tab, so any explanation in these documents
can be checked against live numbers.
