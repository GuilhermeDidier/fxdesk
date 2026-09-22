# How money is stored

Prices are in dollars, customers pay in Sudanese pounds, the owner reports in
euros, and the pound loses value almost every day. The rule that makes this
manageable: **every amount is an integer, stored in the currency it happened
in, next to the rate of the day it happened.** Nothing is ever recalculated
from a "current" rate, price or cost.

## Units

| What | Column suffix | Unit | Example |
| --- | --- | --- | --- |
| Dollars | `_usd_cents` | cents, `bigint` | `$8,506.93` → `850693` |
| Euros | `_eur_cents` | cents, `bigint` | `€7,812.76` → `781276` |
| Pounds | `_sdg` | whole pounds, `bigint` | `68,161,777 SDG` → `68161777` |
| Rates | `_e6` | units per 1 USD × 10⁶, `bigint` | `8,012.5 SDG/USD` → `8012500000` |
| Discounts | `_bps` | basis points, `int` | `4.5%` → `450` |

Pounds are whole pounds because transfers are made in whole pounds. Rates keep
six decimals, which is more than any bank quotes.

## Rounding

One rule everywhere: **round half away from zero**, once per step.

1. Line: `gross = qty × unit price`, `discount = round(gross × bps / 10,000)`, `net = gross − discount`.
2. Order: `total USD = Σ net`.
3. Conversion of the order total (not of each line):
   `SDG = round(total cents × rate_e6 / 10⁸)`, `EUR cents = round(total cents × rate_e6 / 10⁶)`.

Converting the total keeps the pound amount equal to "dollar total × rate", which
is how a dealer checks the number on a calculator.

The same arithmetic exists twice: in SQL (`private.usd_to_sdg` & co., which
books the order) and in `libs/money` (which previews it on screen). The
TypeScript side uses `BigInt` for intermediate products, because
`$2,000,000.00 × 8,012.345678` does not fit in a double. A contract test books
the worked example through the database and checks it against the same fixture
the unit tests use.

## Worked example

Rate of the day: 8,012.5 SDG/USD and 0.9184 EUR/USD.

| Line | Gross | Discount | Net |
| --- | ---: | ---: | ---: |
| 4 × Hybrid inverter 10 kW at $1,249.00, 2% (sand) | $4,996.00 | $99.92 | $4,896.08 |
| 2 × Lithium battery 10 kWh at $1,890.50, 4.5% (red) | $3,781.00 | $170.15 ¹ | $3,610.85 |
| **Total** | | | **$8,506.93** |

¹ 4.5% of $3,781.00 is $170.145 and rounds half up to $170.15.

- Customer pays: 850,693 × 8,012.5 / 100 = 68,161,776.625 → **68,161,777 SDG**
- Reported: 850,693 × 0.9184 = 781,276.45 → **€7,812.76**
- At most 3,000,000 SDG per transfer, so at least **23 transfers**, spread over
  accounts that each take at most 15,000,000 SDG a day.

## What is frozen, and where

| Record | Frozen when | Enforced by |
| --- | --- | --- |
| Rate of a day | as soon as an order or payment uses it | trigger `check_fx_rate` |
| Order totals, rates, lines | at booking | trigger `guard_order`, `order_lines` is append-only |
| Cost of each sold line | at booking (moving-average landed cost) | `order_line_costs` is append-only |
| Payment amount, date, rate, dollar value | at recording | trigger `guard_payment` |
| Currency result per allocation | at allocation | `payment_allocations` is append-only |
| Shipment costs and landed unit costs | when the shipment is closed | triggers on shipments, lines, charges |

The triggers run for every database role, including the service role and the
owner of the functions, so a bug in application code cannot rewrite history
either. Corrections are new entries (a cancellation, an adjustment), not edits.

## Guards on the rate itself

A rate freezes on first use, so a typo would be booked for good. The database
refuses a rate below the company's minimum, and a rate that moves more than
`max_rate_move_bps` (15% by default, per company) against the previous day's.
A genuine devaluation day larger than that is a settings change, made on
purpose, not a slip of the keyboard.

## Goods sold before they land

If a product has no landed cost yet (its container is still at sea), the cost
snapshot uses the supplier's unit price from the latest shipment and is marked
`provisional`. The snapshot is still frozen; the flag tells the owner that the
margin leaves out freight and customs.

## Currency result

An order booked at 8,012.5 locks its price at 68,161,777 SDG. If the dealer pays
2,000,000 SDG a week later, when the rate is 8,200, those pounds are worth
$243.90 instead of the $249.61 they stood for on the order day. The −$5.71 is
the currency result of that transfer, stored on the allocation in USD and in EUR
(at the transfer day's EUR rate).

## Why a report never changes

Report views (`order_profit`, `line_profit`, `profit_by_period`) only add up the
integers above. They never join today's rate, today's price or today's cost.

Euro figures per product or customer convert each line on its own and round
once per line, so their sum can differ by a few cents from the order totals,
which are converted once per order. Each figure is exact for what it measures;
neither is recalculated later.

Periods are assigned by the date things happened: sales and cost to the booking
day, currency result to the day each transfer arrived. A late payment on an old
order lands in the month it arrives, so a closed month cannot move. The report
screen shows a fingerprint (SHA-256 of the stored totals) for each closed month:
the same fingerprint next year means not one cent changed.

The test `tests/db/src/reports.test.ts` checks exactly this: it snapshots every
report view, then changes the list price, closes a shipment with a higher cost
and enters a new rate, and asserts the reports are byte-for-byte identical.
