const jwt = require('jsonwebtoken');
const db = require('../utils/db');
const { hasFeature } = require('../utils/plans');

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';

// Load the caller's organization once per request (plan, status, trial, features).
// Any failure degrades OPEN (request allowed, req.org = null) — authentication
// must never break because of a secondary lookup. 42703-resilient so it works
// before and after migration-plans-backups.txt.
async function loadOrg(req) {
  if (req.org !== undefined) return req.org;
  try {
    const r = await db.query(
      'SELECT id, name, plan, status, trial_ends_at, features, max_users, max_visits_per_month, max_devices, plan_renews_at, settings FROM organizations WHERE id = $1',
      [req.user.org_id]
    );
    req.org = r.rows[0] || null;
  } catch (e) {
    try {
      const r = await db.query(
        'SELECT id, name, plan, status, trial_ends_at, max_users, max_visits_per_month FROM organizations WHERE id = $1',
        [req.user.org_id]
      );
      req.org = r.rows[0] || null;
    } catch (e2) {
      console.error('Org lookup failed (degrading open):', e2.message);
      req.org = null;
    }
  }
  return req.org;
}

// BILLING: soft paywall ("limited mode") instead of a hard lockout.
// An org enters limited mode when its payment is not clear:
//   • free plan past its trial date, or
//   • paid plan past its plan_renews_at date (lapsed renewal)
// In limited mode the portal keeps working with LIMITED capabilities:
// reads, kiosk check-ins/outs, evacuations and account security stay OPEN —
// only management changes (hosts, team, settings, devices, watchlist…) pause
// until payment clears. Reads are never blocked; data never becomes garbage.
// Cancelled/suspended orgs stay HARD-blocked (that's an admin action, not billing).
const LIMITED_OPEN = [
  /^\/api\/visits(\/|$)/,       // check-out, badge ops — the visitor log must keep moving
  /^\/api\/evacuations(\/|$)/,  // safety-critical, never pause
  /^\/api\/kiosk(\/|$)/,        // kiosk operations
  /^\/api\/auth(\/|$)/,         // password change / MFA — account hygiene stays possible
  /^\/api\/notifications(\/|$)/,
];
const isBillingLimited = (org) => {
  if (!org || org.status !== 'active') return false;
  // Complimentary orgs (set by a super admin: settings.complimentary = true) are
  // never billing-limited — the platform owner's own org, partners, charities.
  if (org.settings && org.settings.complimentary === true) return false;
  const now = new Date();
  if (org.plan === 'free') {
    return !!(org.trial_ends_at && new Date(org.trial_ends_at) < now);
  }
  return !!(org.plan_renews_at && new Date(org.plan_renews_at) < now);
};

async function enforceOrgActive(req) {
  // Tech-support sessions (super admin switched into a customer org) are exempt:
  // support must be able to fix things inside expired or suspended customer orgs —
  // that's the whole point of the support session. The block applies to the
  // customer's OWN users, not to Sentinels staff.
  if (req.user && req.user.switched) return null;
  const org = await loadOrg(req);
  if (!org || req.method === 'GET') return null; // reads always open
  if (org.status === 'cancelled') {
    return { status: 403, body: { error: 'This organization account is cancelled. Contact Sentinels support.', code: 'ORG_CANCELLED' } };
  }
  if (org.status === 'suspended') {
    return { status: 403, body: { error: 'This organization is suspended. Contact Sentinels support to reactivate.', code: 'ORG_SUSPENDED' } };
  }
  if (isBillingLimited(org)) {
    const path = (req.originalUrl || req.url || '').split('?')[0];
    if (LIMITED_OPEN.some(re => re.test(path))) return null; // operational paths stay open
    const trial = org.plan === 'free';
    return { status: 403, body: {
      error: trial
        ? 'Your trial has ended and this portal is in limited mode: the kiosk and visitor log keep working, but management changes are paused. Contact Sentinels to activate a plan and unlock everything.'
        : 'Your plan renewal is past due and this portal is in limited mode: the kiosk and visitor log keep working, but management changes are paused. Contact Sentinels to clear the payment and unlock everything.',
      code: 'BILLING_LIMITED'
    } };
  }
  return null;
}

// Feature gate for paid plan features (reports, compliance, sms, backups...).
// Degrades open on any error — a plan-check failure never locks customers out.
const requireFeature = (feature) => {
  return async (req, res, next) => {
    try {
      const org = await loadOrg(req);
      if (!org) return next();
      if (hasFeature(org, feature)) return next();
      return res.status(403).json({
        error: `This feature is not included in your current plan. Contact Sentinels to upgrade.`,
        code: 'FEATURE_LOCKED',
        feature,
      });
    } catch (e) {
      console.error('requireFeature failed (degrading open):', e.message);
      next();
    }
  };
};

// Permission keys used across the app (nav sections + backend route guards)
const ALL_PERMISSIONS = ['visits', 'prereg', 'hosts', 'devices', 'team', 'reports', 'compliance', 'settings', 'deliveries'];
const RECEPTIONIST_PERMISSIONS = ['visits', 'prereg'];

// Resolve a user's effective permissions + display label.
// A custom role (users.role_id -> org_roles) takes precedence over the base role.
async function getUserAccess(user) {
  if (user.role_id) {
    try {
      const r = await db.query('SELECT name, permissions FROM org_roles WHERE id = $1', [user.role_id]);
      if (r.rows[0]) {
        return { role_label: r.rows[0].name, permissions: r.rows[0].permissions || [] };
      }
    } catch (e) {
      if (e.code !== '42P01') throw e; // org_roles table may not exist yet pre-migration
    }
  }
  if (user.role === 'receptionist') {
    return { role_label: 'Receptionist', permissions: RECEPTIONIST_PERMISSIONS };
  }
  return {
    role_label: user.role === 'super_admin' ? 'Super Admin' : 'Admin',
    permissions: user.role === 'super_admin' ? [...ALL_PERMISSIONS, 'super'] : ALL_PERMISSIONS,
  };
}

const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    // Purpose-scoped tokens (e.g. password-change tickets) are not sessions
    if (decoded.purpose) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Keep this SELECT minimal — every column listed here is a hard dependency for
    // EVERY authenticated request. Optional/user-profile columns are fetched by
    // the routes that actually need them (e.g. /auth/me), not here.
    let result;
    try {
      result = await db.query(
        'SELECT id, email, first_name, last_name, role, role_id, org_id, is_active FROM users WHERE id = $1',
        [decoded.userId]
      );
    } catch (e) {
      if (e.code !== '42703') throw e; // role_id column not migrated yet — fall back
      result = await db.query(
        'SELECT id, email, first_name, last_name, role, org_id, is_active FROM users WHERE id = $1',
        [decoded.userId]
      );
    }

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (!result.rows[0].is_active) {
      return res.status(401).json({ error: 'Account is deactivated' });
    }

    req.user = result.rows[0];

    // Org switching: the switch-org endpoint signs tokens with a different orgId.
    // JWTs are server-signed, so a different orgId can only come from that flow.
    if (decoded.orgId && decoded.orgId !== req.user.org_id) {
      req.user.home_org_id = req.user.org_id;
      req.user.org_id = decoded.orgId;
      req.user.switched = true;
    }

    // Plan/trial enforcement for writes — degrades open on any failure
    try {
      const blocked = await enforceOrgActive(req);
      if (blocked) return res.status(blocked.status).json(blocked.body);
    } catch (e) {
      console.error('enforceOrgActive failed (degrading open):', e.message);
    }

    next();
  } catch (err) {
    // Only token problems should log the user out. A database hiccup is a 500,
    // NOT a 401 — otherwise one bad query kicks every user out of the app.
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError' || err.name === 'NotBeforeError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    console.error('Auth middleware error:', err);
    return res.status(500).json({ error: 'Authentication service error — check backend logs' });
  }
};

const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

// Permission guard that understands custom roles.
// Admins/super admins pass everything; custom role checks its permission list;
// receptionists pass only visits/prereg.
const requirePermission = (perm) => {
  return async (req, res, next) => {
    try {
      // Switched sessions were explicitly granted support access by a super admin —
      // they get full access inside the customer org regardless of their home role.
      if (req.user.switched) return next();
      const { permissions } = await getUserAccess(req.user);
      if (req.user.role === 'admin' || req.user.role === 'super_admin' || permissions.includes(perm)) {
        return next();
      }
      return res.status(403).json({ error: 'Insufficient permissions' });
    } catch (err) {
      console.error('Permission check failed:', err);
      return res.status(500).json({ error: 'Permission check failed' });
    }
  };
};

module.exports = { authenticate, requireRole, requirePermission, requireFeature, loadOrg, getUserAccess, isBillingLimited, JWT_SECRET, ALL_PERMISSIONS, RECEPTIONIST_PERMISSIONS };
