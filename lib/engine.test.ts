import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, goalRequirements, project, rng, simulate } from './engine.ts';

/** Deterministic settings: volatility 0 disables every sampling branch. */
const FLAT = { sims: 300, volatility: 0, trafficGrowth: 0, months: 12 };
/** Stochastic settings: noise on, so the seed is observable in the output. */
const NOISY = { sims: 300, volatility: 0.25, trafficGrowth: 0, months: 12 };

test('same seed replays identical output; a new seed does not', () => {
  const x = project({ ...NOISY, seed: 777 });
  const y = project({ ...NOISY, seed: 777 });
  assert.equal(x.medianTotal, y.medianTotal);
  assert.equal(x.probabilityOfGoal, y.probabilityOfGoal);
  assert.deepEqual(x.medianPath, y.medianPath);
  const z = project({ ...NOISY, seed: 778 });
  assert.notEqual(x.medianTotal, z.medianTotal);
});

test('rng is deterministic per seed', () => {
  assert.deepEqual(Array.from({ length: 5 }, rng(42)), Array.from({ length: 5 }, rng(42)));
});

test('no traffic yields no revenue and zero goal probability', () => {
  const r = project({ ...NOISY, monthlyVisitors: 0 });
  assert.equal(r.medianTotal, 0);
  assert.equal(r.p90Total, 0);
  assert.equal(r.probabilityOfGoal, 0);
  assert.equal(r.medianMonthsToGoal, null);
});

test('median revenue rises monotonically with conversion', () => {
  const lo = project({ ...FLAT, conversion: 0.01 });
  const mid = project({ ...FLAT, conversion: 0.02 });
  const hi = project({ ...FLAT, conversion: 0.04 });
  assert.ok(lo.medianTotal < mid.medianTotal);
  assert.ok(mid.medianTotal < hi.medianTotal);
});

test('p10 <= median <= p90 at every month', () => {
  const r = project({ ...DEFAULTS, sims: 400 });
  for (let m = 0; m < r.assumptions.months; m++) {
    assert.ok(r.p10Path[m] <= r.medianPath[m], `p10 exceeds median at month ${m + 1}`);
    assert.ok(r.medianPath[m] <= r.p90Path[m], `median exceeds p90 at month ${m + 1}`);
  }
});

test('zero churn keeps the subscriber base non-decreasing', () => {
  const path = simulate({ ...DEFAULTS, churn: 0, volatility: 0, trafficGrowth: 0 }, rng(1), true);
  for (let m = 1; m < path.units.length; m++) {
    assert.ok(path.units[m] >= path.units[m - 1], `units fell at month ${m + 1}`);
  }
});

test('one-time billing books each sale once at acquisition', () => {
  // 1000 visitors * 2% = 20 sales/mo * $500 * 20 months = $200,000 = 20,000,000 cents.
  const r = project({
    ...FLAT,
    billing: 'one-time',
    monthlyVisitors: 1_000,
    conversion: 0.02,
    priceCents: 50_000,
    months: 20,
  });
  assert.equal(r.medianTotal, 20_000_000);
});

test('goal requirements: $50/mo over 12 months needs 1,667 subscriptions', () => {
  const { requiredUnits, requiredVisitorsFlat } = goalRequirements({
    ...DEFAULTS,
    priceCents: 5_000,
    billing: 'monthly',
    months: 12,
    conversion: 0.02,
  });
  assert.equal(requiredUnits, 1_667); // 1,667 x $600 = $1,000,200
  assert.equal(requiredVisitorsFlat, 83_350); // at 2% CVR
});

test('required-visitor solve lands on the goal within one visitor', () => {
  const a = { ...DEFAULTS, volatility: 0, trafficGrowth: 0, months: 24, priceCents: 5_000 };
  const r = project(a);
  assert.ok(r.requiredVisitors !== null);
  const need = r.requiredVisitors as number;
  const at = simulate({ ...a, monthlyVisitors: need }, rng(0), true);
  const under = simulate({ ...a, monthlyVisitors: need - 1 }, rng(0), true);
  assert.ok(at.total >= a.goalCents, `solve undershot: ${at.total} < ${a.goalCents}`);
  assert.ok(under.total < a.goalCents, `solve overshot at ${need - 1} visitors`);
});

test('goal probability is a multiple of 1/sims', () => {
  const r = project({ ...DEFAULTS, sims: 500 });
  assert.ok(r.probabilityOfGoal >= 0 && r.probabilityOfGoal <= 1);
  assert.equal((r.probabilityOfGoal * 500) % 1, 0);
});
