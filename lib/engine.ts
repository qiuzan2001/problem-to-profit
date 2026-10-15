/**
 * Funnel projection engine.
 *
 * This module models a revenue *projection*. It does not produce money.
 * Every number it returns is a sample path of a stochastic model whose
 * parameters are supplied by the caller (traffic, conversion, price, churn).
 *
 * All currency values are integer cents to avoid float drift in totals.
 */

export type Billing = 'monthly' | 'annual' | 'one-time';

export interface Assumptions {
  /** Visitors in month 1. */
  monthlyVisitors: number;
  /** Compounding month-over-month traffic growth (0.05 = 5%). */
  trafficGrowth: number;
  /** Visitor -> paying customer conversion rate (0.02 = 2%). */
  conversion: number;
  /** Price per unit, in cents. */
  priceCents: number;
  billing: Billing;
  /** Monthly subscriber churn as a fraction (0.05 = 5%). Ignored for one-time. */
  churn: number;
  /** Simulation horizon in months. */
  months: number;
  /** Goal in cents. $1,000,000 = 100_000_000. */
  goalCents: number;
  /** Monte Carlo sample count. */
  sims: number;
  /** PRNG seed; identical seed + assumptions => identical output. */
  seed: number;
  /** Lognormal traffic noise sigma. 0 disables all sampling: fully deterministic path. */
  volatility: number;
}

export const GOAL_CENTS = 100_000_000; // $1,000,000

export const DEFAULTS: Assumptions = {
  monthlyVisitors: 5_000,
  trafficGrowth: 0.08,
  conversion: 0.02,
  priceCents: 5_000,
  billing: 'monthly',
  churn: 0.05,
  months: 24,
  goalCents: GOAL_CENTS,
  sims: 2_000,
  seed: 20_261_015,
  volatility: 0.25,
};

export interface SamplePath {
  /** Cumulative revenue in cents, indexed by month 1..months. */
  cumulative: number[];
  /** Paying units active at end of each month. */
  units: number[];
  /** Month index (1-based) the goal was first reached, else null. */
  goalMonth: number | null;
  /** Final cumulative revenue in cents. */
  total: number;
}

export interface Projection {
  assumptions: Assumptions;
  /** Median cumulative revenue per month, cents. */
  medianPath: number[];
  /** 10th percentile cumulative revenue per month, cents. */
  p10Path: number[];
  /** 90th percentile cumulative revenue per month, cents. */
  p90Path: number[];
  meanTotal: number;
  medianTotal: number;
  p10Total: number;
  p90Total: number;
  /** Fraction of sample paths that reach the goal inside the horizon. */
  probabilityOfGoal: number;
  /** Median months-to-goal across paths that reached it, else null. */
  medianMonthsToGoal: number | null;
  /**
   * Monthly visitors (with all other assumptions fixed, noise-free) required
   * to reach the goal by the end of the horizon. null = unreachable at any
   * finite traffic under these assumptions.
   */
  requiredVisitors: number | null;
  /** Units that must be selling to hit the goal by horizon end. */
  requiredUnits: number;
  /** Visitors needed at the stated conversion to reach requiredUnits. */
  requiredVisitorsFlat: number;
  paths: SamplePath[];
}

/** mulberry32: small, fast, seedable PRNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller standard normal. */
function normal(u1: number, u2: number): number {
  const r = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-12)));
  return r * Math.cos(2 * Math.PI * u2);
}

/** Revenue accrued in a month for `units` active subscribers. */
function monthRevenue(units: number, a: Assumptions): number {
  if (a.billing === 'one-time') return 0; // sales are booked at acquisition
  const per = a.billing === 'annual' ? a.priceCents / 12 : a.priceCents;
  return units * per;
}

/**
 * One sample path. `noise = false` yields the deterministic mean trajectory,
 * used by the required-traffic solver.
 */
export function simulate(a: Assumptions, rand: () => number, noise: boolean): SamplePath {
  const cumulative: number[] = [];
  const unitsPath: number[] = [];
  let units = 0;
  let total = 0;
  let goalMonth: number | null = null;
  let visitors = a.monthlyVisitors;

  for (let m = 1; m <= a.months; m++) {
    if (m > 1) visitors *= 1 + a.trafficGrowth;
    if (noise && a.volatility > 0) {
      const z = normal(rand(), rand());
      visitors *= Math.exp(a.volatility * z - (a.volatility * a.volatility) / 2);
    }
    if (visitors < 0) visitors = 0;

    const expected = visitors * a.conversion;
    let acquired = expected;
    if (noise && a.volatility > 0 && expected > 0) {
      // Binomial -> normal approximation, floored at 0.
      const p = Math.min(Math.max(a.conversion, 0), 1);
      const sd = Math.sqrt(expected * (1 - p));
      acquired = Math.max(0, expected + normal(rand(), rand()) * sd);
    }

    if (a.billing === 'one-time') {
      total += acquired * a.priceCents;
      units += acquired;
    } else {
      const churnRate = a.billing === 'annual' ? a.churn / 12 : a.churn;
      units = units * (1 - churnRate) + acquired;
      total += monthRevenue(units, a);
    }

    unitsPath.push(Math.round(units));
    cumulative.push(Math.round(total));
    if (goalMonth === null && total >= a.goalCents) goalMonth = m;
  }

  return { cumulative, units: unitsPath, goalMonth, total: Math.round(total) };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Deterministic trajectory (no noise) for a given monthly visitor count. */
function deterministicTotal(a: Assumptions, visitors: number): number {
  const path = simulate({ ...a, monthlyVisitors: visitors, volatility: 0 }, Math.random, false);
  return path.total;
}

/**
 * Bisection on monthly visitors for the noise-free path that reaches the goal
 * exactly at horizon end. Monotone in visitors, so bisection is sound.
 */
export function solveRequiredVisitors(a: Assumptions): number | null {
  if (a.conversion <= 0 || a.priceCents <= 0) return null;
  let lo = 0;
  let hi = 1;
  while (deterministicTotal(a, hi) < a.goalCents) {
    hi *= 2;
    if (hi > 1e12) return null;
  }
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (deterministicTotal(a, mid) < a.goalCents) lo = mid;
    else hi = mid;
  }
  return Math.ceil(hi);
}

/** Units and flat traffic implied by the goal, independent of the model path. */
export function goalRequirements(a: Assumptions) {
  const revenuePerUnit =
    a.billing === 'one-time'
      ? a.priceCents
      : a.billing === 'annual'
        ? a.priceCents * (a.months / 12)
        : a.priceCents * a.months;
  const requiredUnits = revenuePerUnit > 0 ? Math.ceil(a.goalCents / revenuePerUnit) : Infinity;
  const requiredVisitorsFlat = a.conversion > 0 ? Math.ceil(requiredUnits / a.conversion) : Infinity;
  return { requiredUnits, requiredVisitorsFlat, revenuePerUnit };
}

export function project(input: Partial<Assumptions>): Projection {
  const a: Assumptions = { ...DEFAULTS, ...input };
  const rand = rng(a.seed);
  const paths: SamplePath[] = [];
  const totals: number[] = [];
  const goalMonths: number[] = [];

  for (let i = 0; i < a.sims; i++) {
    const p = simulate(a, rand, true);
    paths.push(p);
    totals.push(p.total);
    if (p.goalMonth !== null) goalMonths.push(p.goalMonth);
  }

  totals.sort((x, y) => x - y);
  goalMonths.sort((x, y) => x - y);

  const medianPath: number[] = [];
  const p10Path: number[] = [];
  const p90Path: number[] = [];
  for (let m = 0; m < a.months; m++) {
    const col = paths.map((p) => p.cumulative[m]).sort((x, y) => x - y);
    medianPath.push(Math.round(quantile(col, 0.5)));
    p10Path.push(Math.round(quantile(col, 0.1)));
    p90Path.push(Math.round(quantile(col, 0.9)));
  }

  const { requiredUnits, requiredVisitorsFlat } = goalRequirements(a);

  return {
    assumptions: a,
    medianPath,
    p10Path,
    p90Path,
    meanTotal: Math.round(totals.reduce((s, t) => s + t, 0) / totals.length),
    medianTotal: Math.round(quantile(totals, 0.5)),
    p10Total: Math.round(quantile(totals, 0.1)),
    p90Total: Math.round(quantile(totals, 0.9)),
    probabilityOfGoal: goalMonths.length / a.sims,
    medianMonthsToGoal: goalMonths.length ? quantile(goalMonths, 0.5) : null,
    requiredVisitors: solveRequiredVisitors(a),
    requiredUnits,
    requiredVisitorsFlat,
    paths,
  };
}
