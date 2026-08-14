# Business rules

What the Split Spreadsheet actually does, stated independently of how it was
built. This is the specification **Tally** implements; every rule below is
traceable to a formula in [SPREADSHEET-FORMULAS.md](SPREADSHEET-FORMULAS.md) and
to code in `web/src/app/core/`.

---

## 1. The problem

A group of people incur costs together. The costs are uneven in two independent
ways:

- **who benefited** — not everyone ate the same food, slept in the same tent, or
  flew on the same ticket;
- **who paid** — one person's card covered dinner, another bought the firewood,
  a third booked the flights months earlier.

The goal is to turn those two facts into a short list of payments that leaves
everybody square.

Splitting evenly is the trivial case, and most tools stop there. The value of
this model is that it handles the general case without asking the user to do any
arithmetic.

---

## 2. Entities

| Entity | What it is | Code |
| --- | --- | --- |
| **Trip** | One split: a title, a base currency, the people, the expense sheets, and the share grid. | `Trip` |
| **Person** | A participant. Order is significant (see §7.3). | `Person` |
| **Expense sheet** | One check, receipt, or category of spending. Owns its currency, its tax/tip/discount, its items, and optionally its payers. | `ExpenseSheet` |
| **Item** | One line of an expense sheet: a label and an amount in that sheet's currency. | `ExpenseItem` |
| **Share** | What one person owes and paid toward one item, as *relative ratios*. | `Share` |

A trip has one base currency. Every figure the user is asked to act on — the
balances and the payments — is expressed in it.

---

## 3. Share ratios

A share is **two ratios**, not two amounts:

- `owe` — how much of this item this person is on the hook for, **relative to
  the other people on the same row**;
- `pay` — how much of this item this person has **already paid**, on the same
  relative basis.

Ratios are per-row and self-normalising. `1 1 1` and `2 2 2` mean the same
thing. `1 3 4` describes an 8-slice pizza eaten 1 / 3 / 4 without anybody
computing eighths. A blank cell means "did not benefit".

> **Why ratios and not amounts.** Amounts have to be recomputed by hand whenever
> the line total changes — add a tip and every entry is stale. Ratios survive
> price changes, tax changes and currency changes untouched.

The spreadsheet packed both numbers into a single cell as the decimal
`owe.pay` — `1.2` reads "owes 1 share, paid 2". The integer part is `owe`, the
first decimal digit is `pay`. The app still stores the two numbers separately
(`packShare` / `unpackShare`), the same split the decimal always encoded, but
shows and types the cell as `owe|pay` instead: a side that is 0 is left out
rather than spelled out (an owe-only share reads `1`, not `1|0`), and a `0.1`
that could be misread as a fraction becomes an unambiguous `|1`. The `owe.pay`
decimal is still accepted when typed or pasted, so muscle memory from the
original spreadsheet carries over — but the cell's own editor now masks entry
as `_|_` and fills in `owe|pay` as you type, so nobody has to type the `|`
themselves. See `share-cell-editor.ts` and `parseShare` in `split-grid.ts`.

---

## 4. Recording who paid

Two mechanisms, chosen per expense sheet:

**Sheet-level (`paidBy`)** — one or more people covered the whole sheet, split
equally between them. This is the everyday case: someone hands over a card for
the entire check. Selecting payers here makes every `pay` ratio on that sheet
irrelevant.

**Item-level (`pay` ratios)** — payments recorded line by line. Needed when
different people bought different things on the same sheet, such as a camping
trip where everyone brought something.

### Rules

- **R4.1** — The two mechanisms are mutually exclusive *per sheet*. If a sheet
  declares payers, per-item `pay` ratios on that sheet are ignored, and the app
  raises `PAYER_ALREADY_SPECIFIED` rather than silently double-counting.
- **R4.2** — Payment is all-or-nothing across the trip. Once *anyone* is
  recorded as having paid, every priced item needs a payer
  (`PAYER_MISSING`). A half-filled payment column understates what is owed,
  quietly and plausibly, which is the worst kind of wrong.
- **R4.3** — When nobody anywhere is recorded as paying, the trip is in
  "split the check" mode: balances are simply what each person owes, and they
  add up to the trip total.

---

## 5. Money flow within a sheet

All figures in the sheet's own currency unless stated.

```
itemsSubtotal = Σ item.amount

tax           = taxInput.isPercent      ? taxInput.value      × itemsSubtotal : taxInput.value
tip           = tipInput.isPercent      ? tipInput.value      × itemsSubtotal : tipInput.value
discount      = min(itemsSubtotal,
                    discountInput.isPercent ? discountInput.value × itemsSubtotal
                                            : discountInput.value)

sheetTotal    = round(itemsSubtotal + tax + tip − discount, 2)
```

- **R5.1** — Tax, tip and discount each accept **either** a flat amount **or** a
  percentage of the item subtotal. The UI shows the other form alongside, so a
  figure can be checked against the receipt at a glance.
- **R5.2** — Percentages are of the **item subtotal**, never of a
  subtotal-plus-tax. Tip on tax is a policy question, and the spreadsheet's
  answer is no.
- **R5.3** — A discount is capped at the item subtotal. A sheet can reach zero
  but never goes negative.
- **R5.4** — Tax, tip and discount are **spread across the items in proportion
  to price**, then follow those items' share ratios. A person who ordered the
  expensive main course carries proportionally more of the tip. They are never
  divided evenly per head.

Per item:

```
chargePerUnit = itemsSubtotal = 0 ? 0 : (tax + tip − discount) / itemsSubtotal

baseAmount    = item.amount × rate                       // in base currency
chargeShare   = chargePerUnit × item.amount × rate        // its slice of tax/tip/discount
lineTotal     = baseAmount + chargeShare                  // what actually gets divided
```

---

## 6. Currency

- **R6.1** — Each expense sheet either follows the trip's base currency or
  declares its own. Sheets are independent; a trip can mix three currencies.
- **R6.2** — A sheet on the base currency always has rate `1`. This is enforced,
  not merely defaulted.
- **R6.3** — A sheet on its own currency uses a **daily rate** by default, or a
  **pinned rate** if the user types one. Clearing the field reverts to the daily
  rate. Pinning is how you record what the card was actually charged.
- **R6.4** — Conversion happens on the way *into* the split. Everything on the
  Split tab, every balance, and every payment is in the base currency.

---

## 7. Deriving the balances

### 7.1 Per row

```
payUnits  = sheet declares payers ? count(payers) : Σ pay  over the row
costUnits = Σ owe over the row

unitPaid  = payUnits  > 0 ? lineTotal / payUnits  : 0
unitCost  = costUnits > 0 ? lineTotal / costUnits : undefined   // → "no shares assigned"
```

`costUnits = 0` on a priced row means nobody has claimed it. That is an error
(`SHARE_VALUES_MISSING`), not a zero — the money has to land somewhere.

### 7.2 Per person

```
effectivePay(person, row) = row uses sheet payers
                              ? (person is a payer ? 1 : 0)
                              : share.pay

balance(person) = Σ over rows [ unitCost × share.owe − unitPaid × effectivePay ]
```

**Sign convention:** positive means the person still **owes**; negative means
they are **owed**, and is shown in parentheses and red.

- **R7.1** — With payers recorded, balances net to **zero**: every debt has a
  matching credit.
- **R7.2** — Without payers, balances sum to the **trip total**: everyone is
  simply being charged.

### 7.3 The odd cent

Rounding each balance independently can leave the column a cent or two off its
target. The reconciliation pass nudges balances by ±0.01 until they add up:

```
error = (payers recorded) ? Σ balances-in-group : Σ balances − tripTotal
k     = min(|error / 0.01|, count of non-zero people in the group)
```

The first `k` people in the group each move one cent against the error.

- **R7.4** — The displayed balances **always** reconcile exactly. This is a hard
  invariant; a column that doesn't add up destroys trust in everything else on
  the screen.
- **R7.5** — Who absorbs the cent is decided by list order. (The spreadsheet
  chose at random; see [PORTING-NOTES.md](PORTING-NOTES.md) §2.)

---

## 8. Settlement

### 8.1 Baseline

With `n` people carrying a balance, the obvious settlement is a hub: everyone
pays the largest creditor, who pays the remaining creditors. That is `n − 1`
payments and always works.

### 8.2 Groups

Sometimes the balances break into **independent subsets that each net to zero**.
Each subset can settle internally, and the total number of payments drops below
`n − 1`. The app finds the partition with the most such subsets and colours each
one.

- **R8.1** — Grouping is only offered when it beats the baseline. One group is
  the same as no grouping, so no colours are shown.
- **R8.2** — A group must contain at least one debtor and one creditor. A lone
  near-zero balance is not a "group"; there is nobody to settle with.
- **R8.3** — Because grouping runs on rounded balances, a genuinely independent
  group rarely sums to exactly zero. A tolerance of half a cent per member
  absorbs the rounding; the ±0.01 pass (§7.3) then forces each group to zero
  exactly, so the payments always clear.

### 8.3 Payments

Within each group the largest debtor pays the largest creditor as much as
possible. One of the two is fully settled each round, so a group of `m` clears
in at most `m − 1` payments.

---

## 9. Validation

Trip-level, in priority order. The first one is the message the user sees.

| Code | Meaning |
| --- | --- |
| `BASE_CURRENCY_MISSING` | No base currency chosen; nothing can be converted. |
| `NO_PEOPLE` | Nobody to split between. |
| `ITEM_AMOUNT_MISSING` | An item was named but never priced. |
| `PAYER_ALREADY_SPECIFIED` | Per-item payments on a sheet that already declares payers (R4.1). |
| `SHARE_VALUES_MISSING` | A priced item nobody is assigned a share of (§7.1). |
| `PAYER_MISSING` | Payers exist elsewhere but not on this item (R4.2). |
| `DUPLICATE_PERSON` | Two people with the same name — a warning, since ids keep the maths correct. |

Sheet-level:

| Code | Meaning |
| --- | --- |
| `AMOUNT_MISSING` / `ITEM_NAME_MISSING` | Half-entered row. |
| `NEGATIVE_AMOUNT` | Negative item; use the discount field instead. |
| `DUPLICATE_ITEM` | Identical lines should be combined into one row. |
| `UNKNOWN_CURRENCY` | No rate on file; enter one manually. |
| `INVALID_RATE` | Pinned rate must be positive. |
| `UNKNOWN_PAYER` | Paid By refers to a removed person. |
| `DISCOUNT_CAPPED` | Discount exceeded the subtotal and was capped (R5.3). |

**R9.1** — Settlement is withheld entirely while any error is open. A payment
list computed from contradictory inputs is worse than no list.

---

## 10. Worked example

Three people, one restaurant check. Subtotal 90.10, tax 5.61, tip 15%.

| Item | Amount | Jack | Chris | Rose |
| --- | ---: | :-: | :-: | :-: |
| Beer | 15.00 | 1 | 1 | |
| Pizza | 19.80 | 1 | 3 | 4 |
| Burger | 17.30 | 1 | | |
| Steak | 32.00 | | 1 | |
| Coke | 6.00 | | 1 | 1 |

tip = 0.15 × 90.10 = 13.515 → **13.52**
total = 90.10 + 5.61 + 13.515 = 109.225 → **109.23**

Nobody is marked as paying, so R4.3 applies and the balances are pure charges:

| | Jack | Chris | Rose |
| --- | ---: | ---: | ---: |
| **Pays** | 33.07 | 60.52 | 15.64 |

33.07 + 60.52 + 15.64 = 109.23 ✓ (R7.2)

Three more worked examples — item-level payments, multiple sheets with
sheet-level payers, and a case where grouping cuts the payment count — ship as
loadable fixtures in `web/src/app/data/sample-trips.ts` and are
asserted in `split-engine.spec.ts`.
