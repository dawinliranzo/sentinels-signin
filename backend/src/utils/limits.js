// Plan limit enforcement helpers. Every helper degrades OPEN on error —
// a limit-check failure must never block a paying customer's lobby.
const db = require('./db');
const { getOrgLimits } = require('./plans');

const loadOrgRow = async (orgId) => {
  try {
    const r = await db.query(
      'SELECT id, plan, max_users, max_visits_per_month FROM organizations WHERE id = $1',
      [orgId]
    );
    return r.rows[0] || null;
  } catch (e) {
    console.error('loadOrgRow failed (degrading open):', e.message);
    return null;
  }
};

// Monthly visit cap — used by every public check-in path (kiosk, QR, staff badge)
async function checkVisitCap(orgId) {
  try {
    const org = await loadOrgRow(orgId);
    if (!org) return { allowed: true };
    const cap = getOrgLimits(org).max_visits_per_month;
    const c = await db.query(
      `SELECT COUNT(*) as n FROM visits
       WHERE org_id = $1 AND checked_in_at >= DATE_TRUNC('month', CURRENT_DATE)`,
      [orgId]
    );
    const used = Number(c.rows[0].n);
    return used >= cap ? { allowed: false, used, cap } : { allowed: true, used, cap };
  } catch (e) {
    console.error('checkVisitCap failed (degrading open):', e.message);
    return { allowed: true };
  }
}

// Active users cap — used by team invites
async function checkUserCap(org) {
  try {
    if (!org) return { allowed: true };
    const cap = getOrgLimits(org).max_users;
    const c = await db.query(
      'SELECT COUNT(*) as n FROM users WHERE org_id = $1 AND is_active = true',
      [org.id]
    );
    const used = Number(c.rows[0].n);
    return used >= cap ? { allowed: false, used, cap } : { allowed: true, used, cap };
  } catch (e) {
    console.error('checkUserCap failed (degrading open):', e.message);
    return { allowed: true };
  }
}

// Kiosk devices cap — used by device registration
async function checkDeviceCap(org) {
  try {
    if (!org) return { allowed: true };
    const cap = getOrgLimits(org).max_devices;
    const c = await db.query(
      'SELECT COUNT(*) as n FROM devices WHERE org_id = $1 AND is_active = true',
      [org.id]
    );
    const used = Number(c.rows[0].n);
    return used >= cap ? { allowed: false, used, cap } : { allowed: true, used, cap };
  } catch (e) {
    console.error('checkDeviceCap failed (degrading open):', e.message);
    return { allowed: true };
  }
}

module.exports = { checkVisitCap, checkUserCap, checkDeviceCap };
