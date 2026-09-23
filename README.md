# FX Desk

An order desk for a solar-equipment importer: products **priced in dollars**,
**paid in Sudanese pounds** by bank transfer, profit **reported in euros**,
while the pound loses about a quarter of its value in three months.

**Live demo: [fxdesk-demo.vercel.app](https://fxdesk-demo.vercel.app)**. Open it as the sales adviser, the owner, the warehouse or marketing with
one click, and switch persona from the sidebar at any time. Each persona is a real user: what it can see is
decided by the database, not hidden by the screen.

Built with Next.js 16 (App Router, Server Actions), Supabase (Postgres, Auth,
Storage, RLS), Tailwind CSS 4, in an Nx monorepo, tested with Vitest, CI on
GitHub Actions, deployed on Vercel.

## What it does

- **Order screen.** An adviser picks a dealer and products at fixed dollar
  prices, with a discount per line: sand up to 3%, red up to 5%, anything above
  waits for the owner. The pound total uses the rate of the day, and the
  database freezes that rate on the order.
- **Quotes.** Saved like an order, printed as a branded one-page PDF and sent
  on WhatsApp. When the dealer says yes, one click books it as an order at that
  day's rate.
- **Payments.** Each transfer is recorded once, keyed on its bank transaction
  code, with a photo of the receipt, and can pay several orders. Each account
  shows how much of its 15,000,000 SDG daily limit is left. Transfers above
  3,000,000 SDG are refused.
- **Stock.** Freight, customs and transport are spread over every unit of a
  shipment to give the landed cost. The warehouse can release goods only for
  a fully paid order.
- **Profit** per order, product, customer, week and month, in USD or EUR,
  before and after the currency result. Owner only.
- **Customers.** Dealer records with history, open balance, open quotes and
  CRM labels to filter by. This is the marketing persona's screen.
- **Overview** per role: only what that person can act on, worst first
  (discounts waiting for approval, paid orders to release, accounts near their
  daily limit, open quotes, stock below minimum).
- **Four roles** (owner, marketing, sales, warehouse), enforced in the database
  with row-level security. **Multi-tenant** from the first table: every row
  carries `tenant_id`, and brand name, brand colour, discount thresholds,
  minimum rate and transfer limit are settings per tenant.

## The hard part, and how it is solved

See **[docs/money.md](docs/money.md)** for the full rules and a worked example.
In short:

1. Every amount is an integer in its own currency: USD and EUR cents, whole
   pounds, rates × 10⁶. No floats anywhere, in SQL or TypeScript.
2. Every order and payment copies the rate of its own day. Totals, costs and
   currency results are computed once, stored, and locked by triggers that
   even the service role cannot bypass.
3. Reports only add up stored integers, and assign each amount to the date it
   happened, so a closed month returns the same numbers forever. The profit
   screen prints a fingerprint per closed month to prove it.
4. A sales adviser cannot read a cost price, **not even through the API with
   their own token**: costs live in tables whose RLS returns zero rows to
   anyone but the owner, and the report views are `security_invoker`, so they
   inherit that.

## Where the rules live

```
supabase/migrations/
  …01_foundation.sql       tenants, roles, RLS helpers, rates, catalogue
  …02_stock_costs.sql      shipments, landed cost, stock movements
  …03_orders_payments.sql  create_order, record_payment, release_order, immutability
  …04_reports.sql          profit views, bank account status, receipt storage
  …05_quotes.sql           quotes and quote-to-order conversion
  …06_rate_guard.sql       refuses a mistyped rate of the day
  …07_provisional_cost.sql cost of goods sold before they land
libs/money/                integer money maths shared with the UI preview
apps/web/                  Next.js app. Pages stay thin; rules live in the database,
                           screen logic in apps/web/lib (manifest, attention queue,
                           profit grouping, WhatsApp text), each with unit tests
tests/db/                  integration tests against a real Supabase
scripts/seed.ts            demo tenant with 90 days of history
```

Writes to orders and payments go only through `SECURITY DEFINER` functions,
which re-price every line from the catalogue (a price sent by the browser is
ignored), apply the tenant's rules and take row locks where two advisers could
race (the last of an account's daily limit, the last units in stock).

## Tests

| Suite | What it proves |
| --- | --- |
| `libs/money` (unit, 24 tests) | rounding, bands, conversions, parsing, the worked example |
| `apps/web` (unit, 29 tests) | route access per role, the attention queue, profit grouping and fingerprints, WhatsApp text, customer summaries |
| `tests/db/orders` | the database books the worked example with exactly the numbers of the TypeScript preview; client prices are ignored; approval flow; immutability |
| `tests/db/rls` | every cost table and profit view returns nothing to sales, rows to the owner; warehouse sees no payments; tenants are isolated; anonymous gets nothing |
| `tests/db/payments` | 3,000,000 SDG cap, duplicate transaction codes, 15,000,000 SDG daily limit, currency result to the cent, no release before full payment |
| `tests/db/reports` | reports are identical after price, cost and rate changes; used rates and closed shipments cannot be edited; provisional cost for goods at sea |
| `tests/db/quotes` | quotes take no payment and reach no report; conversion re-prices from the catalogue, once; marketing keeps customers but never sees payments or costs |

CI runs lint, typecheck, unit tests and the build, then starts a local Supabase
in Docker, applies every migration from scratch and runs the database suites.

## Run it locally

```bash
npm ci
cp .env.example .env.local           # fill in a Supabase project (or `supabase start`)
supabase db push --db-url "$DATABASE_URL"
npx tsx scripts/seed.ts              # demo tenant and users
npm exec nx dev web                  # http://localhost:3000
npm exec nx run-many -t test         # unit + database tests
```

## Not in this demo yet

Honest list of what a production build would add next:

- WhatsApp Business API: today messages go through `wa.me` links from the
  adviser's own phone.
- Profit per shipment needs lot (FIFO) costing; this demo uses a moving-average
  landed cost, which is exact for margins but cannot attribute a sale to a
  container.
- Bank balances show money received; outgoing transfers are not modelled.
- Arabic right-to-left interface: layouts use logical properties (`ps`, `pe`,
  `text-start`) so the switch is mostly a `dir` attribute and translations.
- Dealer logins (a fifth role scoped to its own customer record).
- A settings screen: the rules are already per-company columns (bands, minimum
  rate, rate move, transfer cap, brand), edited in the database for now.
