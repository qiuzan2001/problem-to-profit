# Click GO → $1,000,000? A funnel projection

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
depends on stated on screen.

Rewritten into something testable:

```gherkin
Given a funnel model with traffic, conversion, price, churn and a horizon
When I click "GO"
Then 2,000 seeded sample paths are simulated
And the median, p10, p90 and P(reach $1,000,000) are displayed
And the run is persisted to SQLite with its seed
And replaying the same seed and inputs reproduces the same numbers
And no Stripe charge, session, or URL is created in simulation mode
```

## Run

```bash
pnpm install
pnpm dev            # http://localhost:3000
pnpm test           # node --test lib/  (engine invariants)
pnpm build && pnpm start
```

## Deploy

Container (`Dockerfile`: multi-stage, `output: 'standalone'`, `node:24-alpine`, non-root `app`
user; the deps stage asserts `node:sqlite` exists before installing):

```bash
docker build -t profit:0.1.1 .
docker run -d --name profit --restart unless-stopped \
  -p 3100:3100 -v profit-data:/app/data profit:0.1.1
```

`/app/data` is a named volume, so projection history survives rebuilds.

Tailnet HTTPS — no cloud account, no inbound rules, cert issued by the tailnet CA:

```bash
tailscale serve --bg --https=8443 http://127.0.0.1:3100
# https://studio01.char-logarithm.ts.net:8443/
tailscale serve --https=8443 off   # remove
```

Reachable from any device on the tailnet (phone, ipad, 5800x). Not public: `tailscale funnel`
would be the public step, deliberately not taken.

## Model

`lib/engine.ts` — pure, seeded (mulberry32), no I/O. All money is integer cents.

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

- `app/api/go/route.ts` — clamps every assumption, runs the projection, inserts a
  `runs` row, returns the summary (sample paths stay server-side).
- `app/api/checkout/route.ts` → `lib/stripe.ts` — `mode()` is `live` only when
  `STRIPE_SECRET_KEY` is set. In `simulation` it performs no network call and
  returns `url: null` with a reason, so the UI cannot display a link that does not
  exist.
- `lib/db.ts` — `node:sqlite` (no native dependency) at `data/projections.db`.
- `components/Dashboard.tsx` — assumption inputs, GO, percentile band chart, goal
  cost panel, run history.

## Environment

| var | effect |
| --- | --- |
| `STRIPE_SECRET_KEY` | unset → SIMULATION banner, no checkout; set → real Checkout Sessions |
| `APP_URL` | success/cancel origin for live checkout, default `http://localhost:3000` |

## What this is not

No customers, no product, no distribution. The default assumptions (5,000
visitors/mo, 2% CVR, $50/mo, 5% churn, 24 months) project a median of about
$1.67M with P(goal) ≈ 79% — that is a property of the numbers you typed, not of
the market. Drop traffic to 300/mo at 0.5% CVR and the same button reports
P(goal) = 0.0% and 29.6× more traffic required. The event this repo was named
after — Dallas AI, *From Problem to Profit*, Oct 15 2026, 6:30 PM, Brookhaven
Building X room BHC‑X1091 — is where the distribution problem is discussed;
this app is the arithmetic you bring to it.
