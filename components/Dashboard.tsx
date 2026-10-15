'use client';

import { useEffect, useState } from 'react';
import { project, type Assumptions, type Billing, type Projection } from '../lib/engine.ts';
import { deployMode, NO_PAYMENT_REASON, paymentUrl } from '../lib/checkout.ts';

type Summary = Omit<Projection, 'paths'>;

interface RunRow {
  id: string;
  at: string;
  seed: number;
  sims: number;
  months: number;
  billing: Billing;
  priceCents: number;
  visitors: number;
  conversion: number;
  churn: number;
  medianTotal: number;
  p90Total: number;
  probabilityOfGoal: number;
  medianMonthsToGoal: number | null;
  requiredVisitors: number | null;
}

const KEY = 'pp.runs.v1';
const CAP = 12;

const usd = (cents: number) =>
  (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });

const count = (n: number) => Math.round(n).toLocaleString('en-US');

const BASE: Assumptions = {
  monthlyVisitors: 5_000,
  trafficGrowth: 0.08,
  conversion: 0.02,
  priceCents: 5_000,
  billing: 'monthly',
  churn: 0.05,
  months: 24,
  goalCents: 100_000_000,
  sims: 2_000,
  seed: 20_261_015,
  volatility: 0.25,
};

const FIELDS = [
  { key: 'monthlyVisitors', label: 'Visitors / month', kind: 'int', min: 0, max: 1_000_000_000, step: 500 },
  { key: 'trafficGrowth', label: 'Traffic growth %/mo', kind: 'pct', min: -50, max: 50, step: 1 },
  { key: 'conversion', label: 'Visitor → paid CVR %', kind: 'pct', min: 0, max: 50, step: 0.1 },
  { key: 'priceCents', label: 'Price (USD)', kind: 'usd', min: 1, max: 10_000_000, step: 100 },
  { key: 'churn', label: 'Monthly churn %', kind: 'pct', min: 0, max: 50, step: 0.5 },
  { key: 'volatility', label: 'Traffic volatility σ', kind: 'pct', min: 0, max: 100, step: 5 },
  { key: 'months', label: 'Horizon (months)', kind: 'int', min: 1, max: 120, step: 1 },
  { key: 'sims', label: 'Sample paths', kind: 'int', min: 100, max: 20_000, step: 500 },
  { key: 'seed', label: 'PRNG seed', kind: 'int', min: 0, max: 2_147_483_647, step: 1 },
] as const;

type FieldKey = (typeof FIELDS)[number]['key'];

function toInput(key: FieldKey, a: Assumptions): number {
  const v = a[key];
  if (typeof v !== 'number') return 0;
  if (key === 'priceCents') return v / 100;
  if (key === 'trafficGrowth' || key === 'conversion' || key === 'churn' || key === 'volatility')
    return v * 100;
  return v;
}

function fromInput(key: FieldKey, raw: number): number {
  if (key === 'priceCents') return Math.round(raw * 100);
  if (key === 'trafficGrowth' || key === 'conversion' || key === 'churn' || key === 'volatility')
    return raw / 100;
  return raw;
}

function readHistory(): RunRow[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as RunRow[]) : [];
  } catch {
    return [];
  }
}

function Band({ r }: { r: Summary }) {
  const W = 720;
  const H = 240;
  const pad = { l: 62, r: 12, t: 12, b: 24 };
  const n = r.medianPath.length;
  const yMax = Math.max(r.p90Path[n - 1] ?? 0, r.assumptions.goalCents) * 1.05;
  const x = (i: number) => pad.l + (i / Math.max(n - 1, 1)) * (W - pad.l - pad.r);
  const y = (v: number) => H - pad.b - (v / yMax) * (H - pad.t - pad.b);
  const line = (arr: number[]) => arr.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const band = [
    r.p90Path.map((v, i) => `${x(i)},${y(v)}`).join(' '),
    r.p10Path.map((_, i) => `${x(n - 1 - i)},${y(r.p10Path[n - 1 - i])}`).join(' '),
  ].join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Cumulative revenue projection band">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" />
          <text x={pad.l - 8} y={y(t) + 3} textAnchor="end">
            {usd(t)}
          </text>
        </g>
      ))}
      <line
        x1={pad.l}
        x2={W - pad.r}
        y1={y(r.assumptions.goalCents)}
        y2={y(r.assumptions.goalCents)}
        stroke="var(--warn)"
        strokeDasharray="5 4"
      />
      <text x={W - pad.r} y={y(r.assumptions.goalCents) - 6} textAnchor="end" fill="var(--warn)">
        goal {usd(r.assumptions.goalCents)}
      </text>
      <polygon points={band} fill="var(--accent)" opacity="0.16" />
      <polyline points={line(r.p90Path)} fill="none" stroke="var(--accent)" opacity="0.45" />
      <polyline points={line(r.p10Path)} fill="none" stroke="var(--accent)" opacity="0.45" />
      <polyline points={line(r.medianPath)} fill="none" stroke="var(--accent)" strokeWidth="2" />
      {[0, Math.floor(n / 2), n - 1].map((i) => (
        <text key={i} x={x(i)} y={H - 8} textAnchor="middle">
          M{i + 1}
        </text>
      ))}
    </svg>
  );
}

export default function Dashboard() {
  const [a, setA] = useState<Assumptions>(BASE);
  const [r, setR] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<RunRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => setHistory(readHistory()), []);

  function go() {
    setBusy(true);
    setNotice(null);
    // Yield one frame so the button repaints before the simulation blocks.
    requestAnimationFrame(() => {
      const p = project(a);
      const { paths: _paths, ...summary } = p;
      setR(summary);
      const row: RunRow = {
        id: `${Date.now()}`,
        at: new Date().toISOString(),
        seed: p.assumptions.seed,
        sims: p.assumptions.sims,
        months: p.assumptions.months,
        billing: p.assumptions.billing,
        priceCents: p.assumptions.priceCents,
        visitors: p.assumptions.monthlyVisitors,
        conversion: p.assumptions.conversion,
        churn: p.assumptions.churn,
        medianTotal: p.medianTotal,
        p90Total: p.p90Total,
        probabilityOfGoal: p.probabilityOfGoal,
        medianMonthsToGoal: p.medianMonthsToGoal,
        requiredVisitors: p.requiredVisitors,
      };
      const next = [row, ...readHistory()].slice(0, CAP);
      localStorage.setItem(KEY, JSON.stringify(next));
      setHistory(next);
      setBusy(false);
    });
  }

  function clearHistory() {
    localStorage.removeItem(KEY);
    setHistory([]);
  }

  function checkout() {
    if (paymentUrl) {
      window.open(paymentUrl, '_blank', 'noopener');
      setNotice(null);
      return;
    }
    setNotice(NO_PAYMENT_REASON);
  }

  const prob = r ? r.probabilityOfGoal : 0;
  const tone = prob >= 0.5 ? 'good' : prob >= 0.1 ? 'warn' : 'bad';
  const gap =
    r && r.requiredVisitors && a.monthlyVisitors > 0 ? r.requiredVisitors / a.monthlyVisitors : null;

  return (
    <div className="stack">
      <div className={`banner ${deployMode === 'checkout' ? 'live' : ''}`}>
        <strong>{deployMode === 'checkout' ? 'PAYMENT LINK BAKED IN' : 'STATIC · PROJECTION ONLY'}</strong>
        <span className="note" style={{ margin: 0 }}>
          {deployMode === 'checkout'
            ? 'A Stripe Payment Link is part of this build. GO is still a projection, not a charge.'
            : 'No server and no secret key: GO runs the model in your browser and keeps history in localStorage. It creates no charge, no session, and no revenue.'}
        </span>
      </div>

      <div className="grid">
        <section className="panel">
          <h2>Assumptions</h2>
          <label htmlFor="billing">Billing</label>
          <select
            id="billing"
            value={a.billing}
            onChange={(e) => setA({ ...a, billing: e.target.value as Billing })}
          >
            <option value="monthly">monthly subscription</option>
            <option value="annual">annual subscription</option>
            <option value="one-time">one-time purchase</option>
          </select>
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label htmlFor={f.key}>{f.label}</label>
              <input
                id={f.key}
                type="number"
                min={f.min}
                max={f.max}
                step={f.step}
                value={toInput(f.key, a)}
                onChange={(e) =>
                  setA({ ...a, [f.key]: fromInput(f.key, Number(e.target.value)) } as Assumptions)
                }
              />
            </div>
          ))}
          <button className="go" onClick={go} disabled={busy}>
            {busy ? 'RUNNING…' : 'GO'}
          </button>
          <button className="ghost" onClick={checkout}>
            Open checkout
          </button>
          {notice ? <p className="note">{notice}</p> : null}
        </section>

        <section className="stack">
          {r ? (
            <>
              <div className="metrics">
                <div className="metric">
                  <div className="k">P(reach $1M in {r.assumptions.months} mo)</div>
                  <div className={`v ${tone}`}>{(prob * 100).toFixed(1)}%</div>
                  <div className="n">
                    {Math.round(prob * r.assumptions.sims)} of {count(r.assumptions.sims)} paths
                  </div>
                </div>
                <div className="metric">
                  <div className="k">Median cumulative revenue</div>
                  <div className="v">{usd(r.medianTotal)}</div>
                  <div className="n">
                    p10 {usd(r.p10Total)} · p90 {usd(r.p90Total)}
                  </div>
                </div>
                <div className="metric">
                  <div className="k">Mean across paths</div>
                  <div className="v">{usd(r.meanTotal)}</div>
                  <div className="n">
                    {r.medianMonthsToGoal
                      ? `median goal month ${Math.ceil(r.medianMonthsToGoal)}`
                      : 'goal not reached on median path'}
                  </div>
                </div>
              </div>

              <div className="panel">
                <h2>Cumulative revenue, {count(r.assumptions.sims)} sample paths</h2>
                <Band r={r} />
                <p className="note">
                  Shaded band = 10th–90th percentile. Line = median. Seed {r.assumptions.seed} makes
                  the run reproducible: identical inputs replay identical output on any machine.
                </p>
              </div>

              <div className="panel">
                <h2>What the goal actually costs</h2>
                <div className="metrics">
                  <div className="metric">
                    <div className="k">Units needed by M{r.assumptions.months}</div>
                    <div className="v">{count(r.requiredUnits)}</div>
                    <div className="n">
                      at {usd(r.assumptions.priceCents)} {r.assumptions.billing}
                    </div>
                  </div>
                  <div className="metric">
                    <div className="k">Visitors needed (flat)</div>
                    <div className="v">{count(r.requiredVisitorsFlat)}</div>
                    <div className="n">at {(r.assumptions.conversion * 100).toFixed(2)}% CVR</div>
                  </div>
                  <div className="metric">
                    <div className="k">Visitors/mo to hit goal</div>
                    <div className="v">{r.requiredVisitors === null ? '∞' : count(r.requiredVisitors)}</div>
                    <div className="n">
                      {gap
                        ? gap >= 1
                          ? `${gap.toFixed(gap >= 10 ? 0 : 1)}× your current traffic`
                          : `${(gap * 100).toFixed(0)}% of your current traffic`
                        : 'noise-free solve'}
                    </div>
                  </div>
                </div>
                <p className="note">
                  Projection only. Reaching the median number requires the traffic, conversion and
                  retention above to be real; no click in this app creates them.
                </p>
              </div>
            </>
          ) : (
            <div className="panel">
              <h2>No run yet</h2>
              <p className="note" style={{ marginTop: 0 }}>
                Set the assumptions, then press GO. The model samples monthly traffic (lognormal),
                acquisitions (binomial ≈ normal), subscriber decay (churn) and books revenue per
                billing mode, then reports the distribution of cumulative revenue against the $1M
                goal. Everything runs client-side from the same seeded engine the tests cover.
              </p>
            </div>
          )}

          <div className="panel">
            <h2>Your recent runs (browser localStorage)</h2>
            {history.length === 0 ? (
              <p className="note" style={{ marginTop: 0 }}>
                none yet
              </p>
            ) : (
              <>
                <table>
                  <thead>
                    <tr>
                      <th>when</th>
                      <th>seed</th>
                      <th>traffic</th>
                      <th>price</th>
                      <th>median</th>
                      <th>p90</th>
                      <th>P($1M)</th>
                      <th>goal month</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((run) => (
                      <tr key={run.id}>
                        <td>{new Date(run.at).toLocaleString('en-US')}</td>
                        <td>{run.seed}</td>
                        <td>{count(run.visitors)}/mo</td>
                        <td>
                          {usd(run.priceCents)} {run.billing === 'monthly' ? '/mo' : run.billing === 'annual' ? '/yr' : ''}
                        </td>
                        <td>{usd(run.medianTotal)}</td>
                        <td>{usd(run.p90Total)}</td>
                        <td>{(run.probabilityOfGoal * 100).toFixed(1)}%</td>
                        <td>{run.medianMonthsToGoal ? `M${Math.ceil(run.medianMonthsToGoal)}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="ghost" onClick={clearHistory}>
                  Clear history
                </button>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
