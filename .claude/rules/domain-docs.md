---
paths:
  - "docs/**"
---

# Editing the specification documents

These four documents are a cross-referenced set, and code comments point into
them. An edit that looks local can break references elsewhere.

- **Rules in `BUSINESS-RULES.md` are numbered, and referenced by number** from
  the other documents and from code comments. Never renumber to tidy up.
  Append a new rule at the end of its section instead.
- `BUSINESS-RULES.md` states the domain *independently of any implementation*.
  Keep implementation detail — class names, file paths, Angular anything — out
  of it. It is the specification the app implements, not a description of the
  app.
- Every deliberate difference between the app and the spreadsheet belongs in
  `PORTING-NOTES.md`, stated with its reasoning. §10 covers persistence.
- `SPREADSHEET-FORMULAS.md` maps recovered formulas to the code that replaces
  them. If a mapping's target moves, update it here too.
- **`workbook-export.json` is generated — never hand-edit it.** Regenerate:

  ```bash
  python tools/export_workbook.py reference/Expenses.xlsx docs/workbook-export.json
  ```

- `docs/README.md` is the ordered index and states the reading order. A new
  document goes in its table, not just into the folder.

Prose style here is plain and reason-first: it explains why the original
behaved as it did, then what the app does about it. Match the surrounding
document rather than switching register.
