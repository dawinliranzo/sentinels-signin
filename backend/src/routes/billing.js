const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { authenticate, requireRole } = require('../middleware/auth');

// ── Card payments via Stripe ─────────────────────────────────────────────────
// Subscriptions (Pro / Enterprise) with Stripe Checkout for signup, the Stripe
// customer portal for card/invoice/cancel management, and a signature-verified
// webhook that keeps organizations.plan / plan_renews_at in sync.
//
// Required Render env vars:
//   STRIPE_SECRET_KEY        sk_live_... (or sk_test_... while testing)
//   STRIPE_WEBHOOK_SECRET    whsec_... (from the webhook you create in Stripe)
//   STRIPE_PRICE_PRO         price_... (recurring monthly price for Pro)
//   STRIPE_PRICE_ENTERPRISE  price_... (recurring monthly price for Enterprise)
//
// The plan column + plan_renews_at drive the soft paywall (middleware/auth
// isBillingLimited): a paid org whose renewal lapses keeps kiosk/check-in
// access but loses management writes until the subscription is restored —
// payments are never "forced" by locking people out of their own lobby.

const APP_URL = process.env.FRONTEND_URL || 'https://app.sentinelskiosk.com';
const PRICES = {
  pro: process.env.STRIPE_PRICE_PRO,
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
};

const stripe = () => require('stripe')(process.env.STRIPE_SECRET_KEY);
const stripeReady = () => !!(process.env.STRIPE_SECRET_KEY && PRICES.pro && PRICES.enterprise);
const notConfigured = (res) => res.status(503).json({
  error: 'Card payments are not configured on the server yet (missing STRIPE_* environment variables). Contact Sentinels support to upgrade manually.'
});

const loadOrgFull = async (orgId) => {
  const r = await db.query(
    'SELECT id, name, plan, status, trial_ends_at, plan_renews_at, settings FROM organizations WHERE id = $1',
    [orgId]
  );
  return r.rows[0] || null;
};

const orgIdForCustomer = async (customerId) => {
  const r = await db.query(
    "SELECT id FROM organizations WHERE settings->>'stripe_customer_id' = $1",
    [customerId]
  );
  return r.rows[0]?.id || null;
};

const planForPrice = (priceId) => Object.keys(PRICES).find((p) => PRICES[p] === priceId) || null;

// Paid and current: set the plan, mark active, anchor the renewal date and
// remember the Stripe ids (stored in settings JSONB — no migration needed)
const activatePlan = async (orgId, plan, customerId, subscriptionId, periodEnd) => {
  await db.query(
    `UPDATE organizations
     SET plan = $2, status = 'active', plan_renews_at = $3,
         settings = COALESCE(settings, '{}'::jsonb) || $4::jsonb
     WHERE id = $1`,
    [orgId, plan, periodEnd, JSON.stringify({
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      billing_via: 'stripe',
    })]
  );
};

// Subscription ended: let the renewal anchor lapse into the past. The org keeps
// its data, kiosk and check-ins (soft paywall), and management access returns
// the moment a new subscription completes — nothing is deleted, nothing forced.
const lapsePlan = async (orgId) => {
  await db.query('UPDATE organizations SET plan_renews_at = NOW() WHERE id = $1', [orgId]);
};

// POST /api/billing/checkout { plan: 'pro' | 'enterprise' } → { url }
// Sends the org admin to Stripe Checkout. If the org's free trial is still
// running, billing only starts when the trial ends (subscription trial_end).
router.post('/checkout', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    if (!stripeReady()) return notConfigured(res);
    const { plan } = req.body || {};
    if (!PRICES[plan]) return res.status(400).json({ error: 'Choose a plan: pro or enterprise' });

    const org = await loadOrgFull(req.user.org_id);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const st = org.settings || {};

    // Complimentary orgs (platform owner, partners) are never billed — there is
    // nothing to buy. The Settings UI hides checkout for them; this is the
    // server-side guarantee.
    if (st.complimentary === true) {
      return res.status(400).json({ error: 'This organization is complimentary — full access, never billed. Nothing to check out.' });
    }

    // An existing subscriber changes plans in the customer portal — a second
    // Checkout would create a duplicate subscription
    if (st.stripe_subscription_id) {
      return res.status(409).json({
        error: 'This organization already has a subscription — use Manage billing to change plans, update the card, or cancel.',
        portal: true,
      });
    }

    const params = {
      mode: 'subscription',
      line_items: [{ price: PRICES[plan], quantity: 1 }],
      success_url: `${APP_URL}/settings?billing=success&plan=${plan}`,
      cancel_url: `${APP_URL}/settings?billing=cancelled`,
      client_reference_id: org.id,
      metadata: { org_id: org.id, plan },
      subscription_data: { metadata: { org_id: org.id, plan } },
      allow_promotion_codes: true,
    };
    if (st.stripe_customer_id) params.customer = st.stripe_customer_id;
    else params.customer_email = req.user.email;
    // A still-running free trial is honored: no charge until it ends
    if (org.plan === 'free' && org.trial_ends_at && new Date(org.trial_ends_at) > new Date()) {
      params.subscription_data.trial_end = Math.floor(new Date(org.trial_ends_at).getTime() / 1000);
    }

    const session = await stripe().checkout.sessions.create(params);
    res.json({ url: session.url });
  } catch (err) {
    console.error('Billing checkout error:', err);
    // Surface Stripe's own message to admins (it names the exact problem — wrong
    // price ID, test/live key mismatch…). Stripe errors carry no secrets.
    const stripeMsg = err && err.type && String(err.type).startsWith('Stripe') ? err.message : null;
    res.status(500).json({ error: stripeMsg || 'Could not start checkout — try again, or contact support' });
  }
});

// POST /api/billing/portal → { url } — Stripe customer portal: cards, invoices,
// plan changes (enable plan switching in the Stripe portal settings), cancel
router.post('/portal', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    if (!stripeReady()) return notConfigured(res);
    const org = await loadOrgFull(req.user.org_id);
    if (org && org.settings && org.settings.complimentary === true) {
      return res.status(400).json({ error: 'This organization is complimentary — full access, never billed. No billing account to manage.' });
    }
    const customerId = (org && org.settings && org.settings.stripe_customer_id) || null;
    if (!customerId) {
      return res.status(400).json({ error: 'No billing account yet — choose a plan first and check out once.' });
    }
    const session = await stripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${APP_URL}/settings`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Billing portal error:', err);
    const stripeMsg = err && err.type && String(err.type).startsWith('Stripe') ? err.message : null;
    res.status(500).json({ error: stripeMsg || 'Could not open the billing portal — try again later' });
  }
});

// POST /api/billing/webhook — Stripe → plan sync. Mounted with express.raw in
// index.js (before express.json) because signature verification needs the raw body.
router.post('/webhook', async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Webhook not configured' });
  }
  let event;
  try {
    event = stripe().webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (e) {
    console.error('Stripe signature verification failed:', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        if (s.mode !== 'subscription') break;
        const orgId = (s.metadata && s.metadata.org_id) || s.client_reference_id;
        const plan = s.metadata && s.metadata.plan;
        if (!orgId || !plan || !s.subscription) break;
        const sub = await stripe().subscriptions.retrieve(s.subscription);
        await activatePlan(orgId, plan, s.customer, sub.id, new Date(sub.current_period_end * 1000));
        console.log(`Billing: org ${orgId} subscribed to ${plan}`);
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const orgId = (sub.metadata && sub.metadata.org_id) || await orgIdForCustomer(sub.customer);
        if (!orgId) break;
        const priceId = sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.id;
        const plan = (sub.metadata && sub.metadata.plan) || planForPrice(priceId);
        if (['active', 'trialing'].includes(sub.status) && plan) {
          await activatePlan(orgId, plan, sub.customer, sub.id, new Date(sub.current_period_end * 1000));
        } else if (['canceled', 'unpaid', 'incomplete_expired'].includes(sub.status)) {
          await lapsePlan(orgId);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const orgId = (sub.metadata && sub.metadata.org_id) || await orgIdForCustomer(sub.customer);
        if (orgId) {
          await lapsePlan(orgId);
          console.log(`Billing: org ${orgId} subscription ended — lapsed into limited mode`);
        }
        break;
      }
      default:
        break; // everything else (invoices, payment intents) needs no action
    }
  } catch (err) {
    // 500 so Stripe retries — a missed event leaves an org on the wrong plan
    console.error('Stripe webhook handling failed:', err);
    return res.status(500).json({ error: 'Webhook handling failed' });
  }
  res.json({ received: true });
});

module.exports = router;
