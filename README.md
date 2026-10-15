# Click GO → $1,000,000? A funnel projection

**Live:** https://qiuzan2001.github.io/problem-to-profit/ (public, GitHub Pages)

Built from this spec:

```gherkin
Given I open this app
When I click go
Then I make a million dollars in revenue
```

The `Then` clause has no verifiable postcondition. Revenue is not a function of a
click; it is a function of traffic × conversion × price × retention. This app does
not pretend otherwise and never prints "goal achieved". It runs the model that the
clause is skipping and reports a **probability**, with the inputs that probability
depends on on screen.

Rewritten into something testable:

```gherkin
Given a funnel model with traffic, conversion, price, churn and a horizon
When I click "GO"
Then 2,000 seeded sample paths are simulated in the browser
And the median, p10, p90 and P(reach $1,000,000) are displayed
And the run is appended to local history with its seed
And replaying the same seed and inputs reproduces the same numbers
And no charge, session, or payment URL is created when none was configured
```

## Run

```bash
pnpm install
pnpm dev            # http://localhost:3000 (no basePath in dev)
pnpm test           # node --test lib/*.test.ts  (engine invariants)
pnpm build          # static export -> out/
pnpm preview        # serve out/ locally
```

## Model

`lib/engine.ts` — pure, seeded (mulberry32), no I/O, runs identically in Node and
in the browser. All money is integer cents.

Per month:

1. `visitors *= (1 + trafficGrowth)`, then lognormal noise `exp(σz − σ²/2)`
2. `acquired ~ Binomial(visitors, cvr)` via normal approximation, floored at 0
3. subscription: `units = units·(1 − churn) + acquired`, revenue `units × price`
   (annual prices accrue monthly, churn is divided by 12);
   one-time: `revenue = acquired × price`, no decay
4. cumulative revenue is compared to the goal; first crossing month is recorded

`σ = 0` disables every sampling branch, so the run collapses to the deterministic
mean trajectory — that is what the required-traffic bisection solves.

Outputs: median/p10/p90 cumulative paths, mean and quantiles of the final total,
`P(goal within horizon)`, median goal month, and the two numbers the goal demands
independently of the path: units needed, and visitors needed at the stated CVR.

## Surfaces

- `components/Dashboard.tsx` — assumption inputs, GO, percentile band chart, goal
  cost panel, run history. Calls `project()` directly; history is
  `localStorage['pp.runs.v1']`, capped at 12 rows, with a clear button.
- `lib/checkout.ts` — price catalog plus `paymentUrl`, read from
  `NEXT_PUBLIC_STRIPE_PAYMENT_LINK` at build time. Absent → the UI shows a reason
  and opens nothing; a link that does not exist can never be displayed.
- `app/page.tsx`, `app/layout.tsx` — shell. No API routes, no server actions.

There is deliberately no server: no `node:sqlite` runs table, no `/api/go`, no
Stripe SDK, no secret key. The public deployment is static files.

## Deploy

`.github/workflows/deploy.yml` runs `pnpm test` then `pnpm build` and publishes
`out/` through `actions/upload-pages-artifact` + `actions/deploy-pages`. Pages
source is `main` with `build_type: workflow`.

Two couplings to know about:

- `next.config.ts` sets `basePath = '/problem-to-profit'` in production, which
  must equal the repo name, or asset URLs 404. Dev runs with no basePath.
- A real checkout needs a Payment Link created in the Stripe dashboard, supplied
  as `NEXT_PUBLIC_STRIPE_PAYMENT_LINK` at build time. It is baked into the bundle,
  so it is public by design — a Payment Link is a public URL, not a secret.

Optional build-time env:

| var | effect |
| --- | --- |
| `NEXT_PUBLIC_STRIPE_PAYMENT_LINK` | unset → "STATIC · PROJECTION ONLY" banner, checkout opens nothing; set → banner flips and the button opens that link |

## What this is not

No customers, no product, no distribution. The default assumptions (5,000
visitors/mo, 2% CVR, $50/mo, 5% churn, 24 months) project a median of about
$1.67M with P(goal) ≈ 79% — that is a property of the numbers you typed, not of
the market. Drop traffic to 300/mo at 0.5% CVR and the same button reports
P(goal) = 0.0% and 29.6× more traffic required. The event this repo was named
after — Dallas AI, *From Problem to Profit*, Oct 15 2026, 6:30 PM, Brookhaven
Building X room BHC‑X1091 — is where the distribution problem is discussed;
this app is the arithmetic you bring to it.
