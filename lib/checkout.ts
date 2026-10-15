import type { Billing } from './engine.ts';

/**
 * Checkout surface for a static deployment: no server, no secret key.
 *
 * A live payment URL exists only if the site was built with
 * NEXT_PUBLIC_STRIPE_PAYMENT_LINK (a Payment Link created in the Stripe
 * dashboard). When it is absent, this module returns null and the UI shows a
 * reason instead of a link, so no checkout can ever be displayed that does not
 * exist.
 */

export interface PriceTier {
  key: string;
  label: string;
  unitAmountCents: number;
  currency: 'usd';
  billing: Billing;
  interval?: 'month' | 'year';
}

export const CATALOG: PriceTier[] = [
  { key: 'starter', label: 'Starter', unitAmountCents: 2_000, currency: 'usd', billing: 'monthly', interval: 'month' },
  { key: 'pro', label: 'Pro', unitAmountCents: 5_000, currency: 'usd', billing: 'monthly', interval: 'month' },
  { key: 'scale', label: 'Scale', unitAmountCents: 9_900, currency: 'usd', billing: 'monthly', interval: 'month' },
  { key: 'annual', label: 'Annual (per year)', unitAmountCents: 50_000, currency: 'usd', billing: 'annual', interval: 'year' },
  { key: 'lifetime', label: 'Lifetime deal', unitAmountCents: 50_000, currency: 'usd', billing: 'one-time' },
];

export const paymentUrl: string | null = process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK ?? null;

export const deployMode: 'checkout' | 'projection-only' = paymentUrl ? 'checkout' : 'projection-only';

export function tierFor(priceCents: number, billing: Billing): PriceTier {
  const exact = CATALOG.find((t) => t.unitAmountCents === priceCents && t.billing === billing);
  if (exact) return exact;
  return {
    key: 'custom',
    label: `Custom ${billing} @ $${(priceCents / 100).toFixed(2)}`,
    unitAmountCents: priceCents,
    currency: 'usd',
    billing,
    interval: billing === 'annual' ? 'year' : billing === 'monthly' ? 'month' : undefined,
  };
}

export const NO_PAYMENT_REASON =
  'This deployment is a projection model. No STRIPE_PAYMENT_LINK was baked into the build, so there is no charge, no session, and no link to open.';
