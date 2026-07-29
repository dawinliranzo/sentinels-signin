const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { checkVisitCap } = require('../utils/limits');
const { getFlagsForVisitor } = require('./flags');
const { getCardForTap, getStaffCardGlobal } = require('./rfid');

// ─── SHARED STAFF (parent/child organizations) ─────────────────────────────
// A badge may be scanned at any kiosk in the same "family": the host's own org,
// its parent, or a sibling — when the host is marked shared_with_children and
// the location hasn't un-selected that person.
// Returns { host, crossOrg } or null when the badge isn't valid at this kiosk.
async function resolveHostForKiosk(orgId, hostId) {
  const r = await db.query('SELECT * FROM hosts WHERE id = $1 AND is_active = true', [hostId]);
  const host = r.rows[0];
  if (!host) return null;
  if (host.org_id === orgId) return { host, crossOrg: false };

  // Cross-org: needs the sharing flag + family relationship + location consent
  if (!host.shared_with_children) return null;

  let family = false;
  try {
    const o = await db.query(
      `SELECT (c.id = p.parent_id OR c.parent_id = p.id OR (c.parent_id IS NOT NULL AND c.parent_id = p.parent_id)) AS family
       FROM organizations c, organizations p
       WHERE c.id = $1 AND p.id = $2`,
      [orgId, host.org_id]
    );
    family = !!o.rows[0]?.family;
  } catch (e) {
    if (e.code === '42703') return null; // parent_id migration not run
    throw e;
  }
  if (!family) return null;

  // Per-location select/unselect (default allowed when no row exists)
  try {
    const a = await db.query(
      'SELECT allowed FROM org_shared_staff WHERE org_id = $1 AND host_id = $2',
      [orgId, hostId]
    );
    if (a.rows.length > 0 && !a.rows[0].allowed) return null;
  } catch (e) {
    if (e.code === '42P01') return null; // sharing migration not run
    throw e;
  }
  return { host, crossOrg: true };
}

// Does visits.device_id exist yet? Caches true; rechecks while false so the
// migration is picked up without a redeploy.
let deviceColumnKnown = null;
async function hasDeviceColumn() {
  if (deviceColumnKnown) return true;
  try {
    await db.query('SELECT device_id FROM visits LIMIT 0');
    deviceColumnKnown = true;
    return true;
  } catch (e) {
    if (e.code === '42703') return false;
    throw e;
  }
}

// Resolve the kiosk device a check-in happened at (and prove it's online):
// validates the device belongs to the org and bumps its last_seen_at.
// Returns null when no/unknown device — visits simply have no location then.
async function resolveDevice(orgId, deviceId) {
  if (!deviceId) return null;
  try {
    const r = await db.query(
      'UPDATE devices SET last_seen_at = NOW() WHERE id = $1 AND org_id = $2 AND is_active = true RETURNING id',
      [deviceId, orgId]
    );
    return r.rows[0]?.id || null;
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return null;
    throw e;
  }
}
const { sendEmail, sendSMS } = require('../utils/notifications');
const { flexAuth } = require('../middleware/apiKey');

// Posts the raw check-in event as JSON to the org's generic webhook URL
// (Settings → Integrations → Webhook). Works with Zapier/Make catch hooks and
// any custom endpoint. Fire-and-forget, same as Teams.
async function notifyGenericWebhook(orgId, event, data) {
  try {
    const r = await db.query('SELECT settings FROM organizations WHERE id = $1', [orgId]);
    const st = (r.rows[0] && r.rows[0].settings) || {};
    const url = st.generic_webhook_url;
    if (!url || st.generic_webhook_enabled === false) return;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, timestamp: new Date().toISOString(), data }),
    });
  } catch (e) {
    console.log('Generic webhook failed:', e.message);
  }
}

// Builds the right payload for the URL flavor: classic Office connectors take
// MessageCard; newer Teams "Workflow" (Power Automate) URLs take Adaptive Cards.
function buildTeamsPayload(url, title, facts) {
  const clean = facts.filter(([, v]) => v);
  if (/logic\.azure\.com|powerautomate|workflow/i.test(url)) {
    return {
      type: 'message',
      attachments: [{
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            { type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium', wrap: true, color: 'Accent' },
            { type: 'FactSet', facts: clean.map(([t, v]) => ({ title: t, value: String(v) })) },
          ],
        },
      }],
    };
  }
  return {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    themeColor: '0D7377',
    summary: title,
    sections: [{ activityTitle: title, facts: clean.map(([name, value]) => ({ name, value: String(value) })), markdown: true }],
  };
}

// Posts a check-in card to the org's Microsoft Teams channel when a webhook URL
// is configured (Settings → Integrations). Fire-and-forget by design: a Teams
// outage must never delay or break a kiosk check-in.
async function notifyTeams(orgId, title, facts) {
  try {
    const r = await db.query('SELECT settings FROM organizations WHERE id = $1', [orgId]);
    const st = (r.rows[0] && r.rows[0].settings) || {};
    const url = st.teams_webhook_url;
    if (!url || st.teams_notifications === false) return;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildTeamsPayload(url, title, facts)),
    });
  } catch (e) {
    console.log('Teams notification failed:', e.message);
  }
}

// Fallback NDA text when the org has turned on NDA signing but hasn't written
// their own document yet. The kiosk shows the same fallback.
const DEFAULT_NDA_TEXT = `VISITOR NON-DISCLOSURE AGREEMENT

By signing below, the visitor agrees to keep confidential all non-public information, materials, and activities observed or accessed while on these premises.

The visitor agrees not to disclose, copy, photograph, record, or share any such information with any third party, and to follow all site safety and security rules for the duration of the visit.

This agreement takes effect upon signing and remains in effect after the visit ends.`;

// PUBLIC ENDPOINTS (must come BEFORE authenticated routes with params)
router.get('/active/public/:orgId', async (req, res) => {
  try {
    const { search } = req.query;
    let query = `
      SELECT v.*, 
        h.first_name as host_first_name, h.last_name as host_last_name
      FROM visits v
      LEFT JOIN hosts h ON v.host_id = h.id
      WHERE v.org_id = $1 AND v.status = 'checked_in'
    `;
    const params = [req.params.orgId];

    if (search) {
      query += ` AND (v.visitor_first_name ILIKE $2 OR v.visitor_last_name ILIKE $2 OR v.badge_number ILIKE $2)`;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY v.checked_in_at DESC`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Public active visits error:', err);
    res.status(500).json({ error: 'Failed to fetch active visits' });
  }
});

// PUBLIC kiosk check-out (no auth — verifies the visit belongs to the given org instead)
router.post('/public/check-out', async (req, res) => {
  try {
    const { visit_id, org_id } = req.body;
    if (!visit_id || !org_id) {
      return res.status(400).json({ error: 'visit_id and org_id are required' });
    }

    const result = await db.query(`
      UPDATE visits 
      SET status = 'checked_out', checked_out_at = NOW(), check_out_notes = $3
      WHERE id = $1 AND org_id = $2 AND status = 'checked_in'
      RETURNING *
    `, [visit_id, org_id, 'Kiosk self check-out']);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Visit not found or already checked out' });
    }

    const checkedOutVisit = result.rows[0];
    if (checkedOutVisit.pre_reg_id) {
      try {
        await db.query("UPDATE pre_registered_visitors SET invitation_status = 'checked_out' WHERE id = $1", [checkedOutVisit.pre_reg_id]);
      } catch (preErr) {
        console.error('Failed to update pre-registration status:', preErr);
      }
    }
    res.json({ success: true, visit: checkedOutVisit });
  } catch (err) {
    console.error('Public check-out error:', err);
    res.status(500).json({ error: 'Check-out failed' });
  }
});

// PUBLIC: staff badge scan — toggles an employee's visit in/out
router.post('/staff-checkin', async (req, res) => {
  try {
    const { org_id, host_id, device_id } = req.body;
    if (!org_id || !host_id) {
      return res.status(400).json({ error: 'org_id and host_id are required' });
    }

    let host, crossOrg = false;
    try {
      const resolved = await resolveHostForKiosk(org_id, host_id);
      host = resolved?.host;
      crossOrg = resolved?.crossOrg || false;
    } catch (e) {
      if (e.code !== '42703' && e.code !== '42P01') throw e; // pre-migration: same-org only
      const hostRes = await db.query(
        'SELECT * FROM hosts WHERE id = $1 AND org_id = $2 AND is_active = true',
        [host_id, org_id]
      );
      host = hostRes.rows[0];
    }
    if (!host) {
      return res.status(404).json({ error: 'Badge not recognized for this kiosk' });
    }
    const staffEmail = host.email || `host-${host.id}@staff.local`;

    // Active staff visit for this employee?
    const active = await db.query(
      `SELECT * FROM visits WHERE org_id = $1 AND LOWER(visitor_email) = LOWER($2)
         AND sign_in_method = 'staff_qr' AND status = 'checked_in'
       ORDER BY checked_in_at DESC LIMIT 1`,
      [org_id, staffEmail]
    );

    if (active.rows.length > 0) {
      const out = await db.query(
        `UPDATE visits SET status = 'checked_out', checked_out_at = NOW(), check_out_notes = 'Staff badge check-out'
         WHERE id = $1 RETURNING *`,
        [active.rows[0].id]
      );
      return res.json({
        action: 'checked_out',
        name: host.first_name,
        photo: host.photo_data || null,
        notes: host.notes || null,
        visit: out.rows[0]
      });
    }

    const cap = await checkVisitCap(org_id);
    if (!cap.allowed) {
      return res.status(429).json({ error: `Monthly visit limit reached (${cap.cap}). Please contact your organization administrator to upgrade the plan.`, code: 'VISIT_CAP' });
    }

    const date = new Date();
    const badgeNum = `${String(date.getFullYear()).slice(2)}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;
    const withDevice = await hasDeviceColumn();
    const deviceId = withDevice ? await resolveDevice(org_id, device_id) : null;
    const ins = await db.query(
      withDevice
        ? `INSERT INTO visits (org_id, visitor_type_id, host_id, visitor_first_name, visitor_last_name, visitor_email, visitor_phone, visitor_company, purpose, badge_number, sign_in_method, status, checked_in_at, device_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'staff_qr', 'checked_in', NOW(), $11) RETURNING *`
        : `INSERT INTO visits (org_id, visitor_type_id, host_id, visitor_first_name, visitor_last_name, visitor_email, visitor_phone, visitor_company, purpose, badge_number, sign_in_method, status, checked_in_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'staff_qr', 'checked_in', NOW()) RETURNING *`,
      withDevice
        ? [org_id, null, null, host.first_name, host.last_name, staffEmail, host.phone || null, host.department || 'Staff', crossOrg ? 'Employee check-in (other location)' : 'Employee check-in', badgeNum, deviceId]
        : [org_id, null, null, host.first_name, host.last_name, staffEmail, host.phone || null, host.department || 'Staff', crossOrg ? 'Employee check-in (other location)' : 'Employee check-in', badgeNum]
    );

    res.json({
      action: 'checked_in',
      name: host.first_name,
      photo: host.photo_data || null,
      notes: host.notes || null,
      badge: ins.rows[0].badge_number,
      visit: ins.rows[0]
    });
    notifyGenericWebhook(org_id, 'staff.checkin', {
      visit_id: ins.rows[0].id,
      host_id: host.id,
      first_name: host.first_name, last_name: host.last_name,
      department: host.department,
      cross_org: crossOrg,
      badge_number: ins.rows[0].badge_number,
      checked_in_at: ins.rows[0].checked_in_at,
    });
    notifyTeams(org_id, `${crossOrg ? 'Staff (other location)' : 'Staff'} checked in: ${host.first_name} ${host.last_name}`, [
      ['Department', host.department],
      ['Badge', ins.rows[0].badge_number],
      ['Time', new Date().toLocaleString()],
    ]).catch(() => {});
  } catch (err) {
    console.error('Staff check-in error:', err);
    res.status(500).json({ error: 'Staff check-in failed', details: err.message });
  }
});

// PUBLIC: frequent-visitor badge scan — toggles that person's visit in/out.
// The kiosk sends { org_id, code } from the FV-XXXXX QR (scanned as "FV:FV-XXXXX").
router.post('/fv-checkin', async (req, res) => {
  try {
    const { org_id, code, device_id } = req.body;
    if (!org_id || !code) {
      return res.status(400).json({ error: 'Organization ID and code are required' });
    }
    const cleanCode = String(code).trim().toUpperCase().replace(/^FV:/, '');

    let fvRow;
    try {
      const r = await db.query(
        'SELECT * FROM frequent_visitors WHERE org_id = $1 AND UPPER(code) = $2',
        [org_id, cleanCode]
      );
      fvRow = r.rows[0];
    } catch (e) {
      if (e.code === '42P01') return res.status(500).json({ error: 'Frequent visitors table is missing — run migration-visitor-alerts.txt in Render PSQL' });
      throw e;
    }
    if (!fvRow) {
      return res.status(404).json({ error: 'Badge not recognized. Please use the regular sign-in.' });
    }
    if (!fvRow.is_active) {
      return res.status(403).json({ error: 'This badge has been deactivated. Please see the front desk.' });
    }

    // Blacklist check (same rule as regular check-in — by email OR by name)
    const fvFlags = await getFlagsForVisitor(org_id, fvRow.email, fvRow.first_name, fvRow.last_name);
    if (fvFlags.find(f => f.severity === 'blacklist')) {
      return res.status(403).json({ error: 'This visitor is not permitted on site. Please see the front desk.', code: 'VISITOR_BLACKLISTED' });
    }

    // Toggle: already on site (matched by email, or by name when no email)? → sign out
    const matchClause = fvRow.email
      ? { sql: 'LOWER(visitor_email) = LOWER($2)', params: [org_id, fvRow.email] }
      : { sql: 'LOWER(visitor_first_name) = LOWER($2) AND LOWER(visitor_last_name) = LOWER($3)', params: [org_id, fvRow.first_name, fvRow.last_name] };
    const active = await db.query(
      `SELECT id FROM visits WHERE org_id = $1 AND status = 'checked_in' AND ${matchClause.sql}
       ORDER BY checked_in_at DESC LIMIT 1`,
      matchClause.params
    );
    if (active.rows.length > 0) {
      const out = await db.query(
        `UPDATE visits SET status = 'checked_out', checked_out_at = NOW() WHERE id = $1 RETURNING *`,
        [active.rows[0].id]
      );
      return res.json({ action: 'checked_out', name: fvRow.first_name, code: fvRow.code, visit: out.rows[0] });
    }

    const cap = await checkVisitCap(org_id);
    if (!cap.allowed) {
      return res.status(429).json({ error: `Monthly visit limit reached (${cap.cap}). Please contact the front desk — the organization needs to upgrade its plan.`, code: 'VISIT_CAP' });
    }

    const date = new Date();
    const badgeNum = `${String(date.getFullYear()).slice(2)}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;
    const withDevice = await hasDeviceColumn();
    const deviceId = withDevice ? await resolveDevice(org_id, device_id) : null;
    const ins = await db.query(
      withDevice
        ? `INSERT INTO visits (org_id, visitor_type_id, host_id, visitor_first_name, visitor_last_name, visitor_email, visitor_phone, visitor_company, purpose, badge_number, sign_in_method, status, checked_in_at, device_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'qr', 'checked_in', NOW(), $11) RETURNING *`
        : `INSERT INTO visits (org_id, visitor_type_id, host_id, visitor_first_name, visitor_last_name, visitor_email, visitor_phone, visitor_company, purpose, badge_number, sign_in_method, status, checked_in_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'qr', 'checked_in', NOW()) RETURNING *`,
      withDevice
        ? [org_id, null, null, fvRow.first_name, fvRow.last_name, fvRow.email || null, fvRow.phone || null, fvRow.company || null, 'Frequent visit', badgeNum, deviceId]
        : [org_id, null, null, fvRow.first_name, fvRow.last_name, fvRow.email || null, fvRow.phone || null, fvRow.company || null, 'Frequent visit', badgeNum]
    );
    notifyGenericWebhook(org_id, 'frequent_visitor.checkin', {
      visit_id: ins.rows[0].id,
      first_name: fvRow.first_name, last_name: fvRow.last_name,
      company: fvRow.company,
      badge_number: ins.rows[0].badge_number,
      checked_in_at: ins.rows[0].checked_in_at,
    });
    notifyTeams(org_id, `Frequent visitor: ${fvRow.first_name} ${fvRow.last_name}`, [
      ['Company', fvRow.company],
      ['Badge', ins.rows[0].badge_number],
      ['Time', new Date().toLocaleString()],
    ]).catch(() => {});
    res.json({ action: 'checked_in', name: fvRow.first_name, code: fvRow.code, badge: ins.rows[0].badge_number, visit: ins.rows[0] });
  } catch (err) {
    console.error('FV check-in error:', err);
    res.status(500).json({ error: 'Badge scan failed', details: err.message });
  }
});

// PUBLIC: RFID card tap — a USB keyboard-emulation reader "types" the card UID,
// the kiosk sends { org_id, uid }. The card maps to a staff member or a frequent
// visitor; the tap toggles them in/out exactly like their QR badges do.
router.post('/rfid-tap', async (req, res) => {
  try {
    const { org_id, uid, device_id } = req.body;
    if (!org_id || !uid) {
      return res.status(400).json({ error: 'Organization ID and card UID are required' });
    }
    let resolved = await getCardForTap(org_id, String(uid).trim());
    let crossOrgStaff = null;
    if (!resolved) {
      // Maybe a staff card from another location in the same family
      const globalCard = await getStaffCardGlobal(String(uid).trim());
      if (globalCard) {
        try {
          const fam = await resolveHostForKiosk(org_id, globalCard.id);
          if (fam) {
            crossOrgStaff = fam.host;
            resolved = { kind: 'staff', person: crossOrgStaff };
          }
        } catch (e) {
          if (e.code !== '42703' && e.code !== '42P01') throw e;
        }
      }
    }
    if (!resolved) {
      return res.status(404).json({ error: 'Card not recognized. Please use the regular sign-in.' });
    }
    const p = resolved.person;
    if (!p.is_active) {
      return res.status(403).json({ error: 'This card has been deactivated. Please see the front desk.' });
    }
    const crossOrg = !!crossOrgStaff;

    if (resolved.kind === 'staff') {
      // ─── Staff toggle (same rules as the STAFF: QR badge) ───
      const staffEmail = p.email || `host-${p.id}@staff.local`;
      const active = await db.query(
        `SELECT * FROM visits WHERE org_id = $1 AND LOWER(visitor_email) = LOWER($2)
           AND sign_in_method = 'staff_qr' AND status = 'checked_in'
         ORDER BY checked_in_at DESC LIMIT 1`,
        [org_id, staffEmail]
      );
      if (active.rows.length > 0) {
        const out = await db.query(
          `UPDATE visits SET status = 'checked_out', checked_out_at = NOW(), check_out_notes = 'Staff badge check-out'
           WHERE id = $1 RETURNING *`,
          [active.rows[0].id]
        );
        return res.json({ action: 'checked_out', card_type: 'staff', name: p.first_name, photo: p.photo_data || null, notes: p.notes || null, visit: out.rows[0] });
      }
      const cap = await checkVisitCap(org_id);
      if (!cap.allowed) {
        return res.status(429).json({ error: `Monthly visit limit reached (${cap.cap}). Please contact your organization administrator to upgrade the plan.`, code: 'VISIT_CAP' });
      }
      const date = new Date();
      const badgeNum = `${String(date.getFullYear()).slice(2)}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;
      const withDevice = await hasDeviceColumn();
      const deviceId = withDevice ? await resolveDevice(org_id, device_id) : null;
      const ins = await db.query(
        withDevice
          ? `INSERT INTO visits (org_id, visitor_type_id, host_id, visitor_first_name, visitor_last_name, visitor_email, visitor_phone, visitor_company, purpose, badge_number, sign_in_method, status, checked_in_at, device_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'staff_qr', 'checked_in', NOW(), $11) RETURNING *`
          : `INSERT INTO visits (org_id, visitor_type_id, host_id, visitor_first_name, visitor_last_name, visitor_email, visitor_phone, visitor_company, purpose, badge_number, sign_in_method, status, checked_in_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'staff_qr', 'checked_in', NOW()) RETURNING *`,
        withDevice
          ? [org_id, null, null, p.first_name, p.last_name, staffEmail, p.phone || null, p.department || 'Staff', crossOrg ? 'Employee check-in (other location)' : 'Employee check-in', badgeNum, deviceId]
          : [org_id, null, null, p.first_name, p.last_name, staffEmail, p.phone || null, p.department || 'Staff', crossOrg ? 'Employee check-in (other location)' : 'Employee check-in', badgeNum]
      );
      return res.json({ action: 'checked_in', card_type: 'staff', name: p.first_name, photo: p.photo_data || null, notes: p.notes || null, badge: ins.rows[0].badge_number, visit: ins.rows[0] });
    }

    // ─── Frequent-visitor toggle (same rules as the FV: QR badge) ───
    if (p.email) {
      const flags = await getFlagsForVisitor(org_id, p.email, p.first_name, p.last_name);
      if (flags.find(f => f.severity === 'blacklist')) {
        return res.status(403).json({ error: 'This visitor is not permitted on site. Please see the front desk.', code: 'VISITOR_BLACKLISTED' });
      }
    }
    const matchClause = p.email
      ? { sql: 'LOWER(visitor_email) = LOWER($2)', params: [org_id, p.email] }
      : { sql: 'LOWER(visitor_first_name) = LOWER($2) AND LOWER(visitor_last_name) = LOWER($3)', params: [org_id, p.first_name, p.last_name] };
    const active = await db.query(
      `SELECT id FROM visits WHERE org_id = $1 AND status = 'checked_in' AND ${matchClause.sql}
       ORDER BY checked_in_at DESC LIMIT 1`,
      matchClause.params
    );
    if (active.rows.length > 0) {
      const out = await db.query(
        `UPDATE visits SET status = 'checked_out', checked_out_at = NOW() WHERE id = $1 RETURNING *`,
        [active.rows[0].id]
      );
      return res.json({ action: 'checked_out', card_type: 'frequent', name: p.first_name, code: p.code, visit: out.rows[0] });
    }
    const cap = await checkVisitCap(org_id);
    if (!cap.allowed) {
      return res.status(429).json({ error: `Monthly visit limit reached (${cap.cap}). Please contact the front desk — the organization needs to upgrade its plan.`, code: 'VISIT_CAP' });
    }
    const date = new Date();
    const badgeNum = `${String(date.getFullYear()).slice(2)}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;
    const withDevice = await hasDeviceColumn();
    const deviceId = withDevice ? await resolveDevice(org_id, device_id) : null;
    const ins = await db.query(
      withDevice
        ? `INSERT INTO visits (org_id, visitor_type_id, host_id, visitor_first_name, visitor_last_name, visitor_email, visitor_phone, visitor_company, purpose, badge_number, sign_in_method, status, checked_in_at, device_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'qr', 'checked_in', NOW(), $11) RETURNING *`
        : `INSERT INTO visits (org_id, visitor_type_id, host_id, visitor_first_name, visitor_last_name, visitor_email, visitor_phone, visitor_company, purpose, badge_number, sign_in_method, status, checked_in_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'qr', 'checked_in', NOW()) RETURNING *`,
      withDevice
        ? [org_id, null, null, p.first_name, p.last_name, p.email || null, p.phone || null, p.company || null, 'Frequent visit', badgeNum, deviceId]
        : [org_id, null, null, p.first_name, p.last_name, p.email || null, p.phone || null, p.company || null, 'Frequent visit', badgeNum]
    );
    res.json({ action: 'checked_in', card_type: 'frequent', name: p.first_name, code: p.code, badge: ins.rows[0].badge_number, visit: ins.rows[0] });
  } catch (err) {
    console.error('RFID tap error:', err);
    res.status(500).json({ error: 'Card tap failed', details: err.message });
  }
});

// AUTHENTICATED ENDPOINTS
router.get('/active', flexAuth, requirePermission('visits'), async (req, res) => {
  try {
    const result = await db.query(`
      SELECT v.*, 
        h.first_name as host_first_name, h.last_name as host_last_name, h.email as host_email, h.phone as host_phone,
        vt.name as visitor_type_name, vt.badge_color,
        d.name as device_name
      FROM visits v
      LEFT JOIN hosts h ON v.host_id = h.id
      LEFT JOIN visitor_types vt ON v.visitor_type_id = vt.id
      LEFT JOIN devices d ON v.device_id = d.id
      WHERE v.org_id = $1 AND v.status = 'checked_in'
      ORDER BY v.checked_in_at DESC
    `, [req.user.org_id]);

    res.json(result.rows);
  } catch (err) {
    if (err.code === '42703') {
      // device_id migration not run yet — same query without the device join
      try {
        const fallback = await db.query(`
          SELECT v.*, 
            h.first_name as host_first_name, h.last_name as host_last_name, h.email as host_email, h.phone as host_phone,
            vt.name as visitor_type_name, vt.badge_color
          FROM visits v
          LEFT JOIN hosts h ON v.host_id = h.id
          LEFT JOIN visitor_types vt ON v.visitor_type_id = vt.id
          WHERE v.org_id = $1 AND v.status = 'checked_in'
          ORDER BY v.checked_in_at DESC
        `, [req.user.org_id]);
        return res.json(fallback.rows);
      } catch (e2) {
        console.error(e2);
        return res.status(500).json({ error: 'Failed to fetch active visits' });
      }
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch active visits' });
  }
});

router.get('/', flexAuth, requirePermission('visits'), async (req, res) => {
  try {
    const { date, status, host_id, search, from, to } = req.query;
    const withDevice = await hasDeviceColumn();
    let query = `
      SELECT v.*, 
        h.first_name as host_first_name, h.last_name as host_last_name,
        vt.name as visitor_type_name${withDevice ? `,
        d.name as device_name` : ''}
      FROM visits v
      LEFT JOIN hosts h ON v.host_id = h.id
      LEFT JOIN visitor_types vt ON v.visitor_type_id = vt.id${withDevice ? `
      LEFT JOIN devices d ON v.device_id = d.id` : ''}
      WHERE v.org_id = $1
    `;
    const params = [req.user.org_id];
    let paramCount = 1;

    if (date) {
      paramCount++;
      query += ` AND DATE(v.checked_in_at) = $${paramCount}`;
      params.push(date);
    }
    // Date+time range (ISO datetimes from the UI, e.g. 2026-07-15T09:00)
    if (from) {
      paramCount++;
      query += ` AND v.checked_in_at >= $${paramCount}`;
      params.push(new Date(from).toISOString());
    }
    if (to) {
      paramCount++;
      query += ` AND v.checked_in_at <= $${paramCount}`;
      params.push(new Date(to).toISOString());
    }
    if (status) {
      paramCount++;
      query += ` AND v.status = $${paramCount}`;
      params.push(status);
    }
    if (host_id) {
      paramCount++;
      query += ` AND v.host_id = $${paramCount}`;
      params.push(host_id);
    }
    if (search) {
      paramCount++;
      query += ` AND (v.visitor_first_name ILIKE $${paramCount} OR v.visitor_last_name ILIKE $${paramCount} OR v.visitor_email ILIKE $${paramCount}
        OR v.badge_number ILIKE $${paramCount} OR h.first_name ILIKE $${paramCount} OR h.last_name ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY v.checked_in_at DESC LIMIT 500`;

    const result = await db.query(query, params);

    // Flag visits that have a signed NDA attached. Separate query (not a JOIN)
    // so the list keeps working if the NDA migration hasn't been run yet.
    let signedIds = new Set();
    try {
      const ids = result.rows.map(r => r.id);
      if (ids.length > 0) {
        const nda = await db.query('SELECT DISTINCT visit_id FROM nda_signatures WHERE visit_id = ANY($1)', [ids]);
        signedIds = new Set(nda.rows.map(r => r.visit_id));
      }
    } catch (ndaErr) {
      if (ndaErr.code !== '42P01') console.error('NDA flag lookup failed:', ndaErr.message);
    }

    res.json(result.rows.map(r => ({ ...r, nda_signed: signedIds.has(r.id) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch visits' });
  }
});

// GET /api/visits/:id/nda — the signed NDA attached to a visit (admins)
router.get('/:id/nda', authenticate, requirePermission('visits'), async (req, res) => {
  try {
    const r = await db.query(
      'SELECT * FROM nda_signatures WHERE visit_id = $1 AND org_id = $2 ORDER BY signed_at DESC LIMIT 1',
      [req.params.id, req.user.org_id]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: 'No signed NDA found for this visit' });
    }
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(500).json({ error: 'NDA table missing — run the NDA migration in Render PSQL (migration-nda.txt)' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to load signed NDA' });
  }
});

router.post('/check-in', async (req, res) => {
  try {
    let {
      org_id,
      visitor_type_id,
      host_id,
      first_name,
      last_name,
      email,
      phone,
      company,
      purpose,
      vehicle_plate,
      custom_data,
      sign_in_method = 'kiosk',
      pre_reg_id,
      photo_data,
      nda_signature,
      nda_signed_name,
      device_id
    } = req.body;

    // ─── ORG VALIDATION ───
    if (!org_id) {
      return res.status(400).json({ error: 'Organization ID is required' });
    }

    const orgCheck = await db.query('SELECT id, status, settings FROM organizations WHERE id = $1', [org_id]);
    if (orgCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid organization ID' });
    }
    if (orgCheck.rows[0].status !== 'active') {
      return res.status(403).json({ error: 'Organization is not active' });
    }
    // ─── END ORG VALIDATION ───

    const orgSettings = orgCheck.rows[0].settings || {};

    // ─── INPUT VALIDATION: the kiosk is public — never trust what people type ───
    // Names: letters (any language), spaces, hyphens, apostrophes, periods. No digits/symbols.
    const NAME_RE = /^[\p{L}][\p{L}\s.'-]{0,99}$/u;
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    const PHONE_RE = /^[+()\-\.\s\d]{7,20}$/;

    first_name = (first_name || '').trim().replace(/\s+/g, ' ');
    last_name = (last_name || '').trim().replace(/\s+/g, ' ');
    email = (email || '').trim().toLowerCase();
    phone = (phone || '').trim();
    company = (company || '').trim();
    purpose = (purpose || '').trim();
    vehicle_plate = (vehicle_plate || '').trim().toUpperCase();

    if (!NAME_RE.test(first_name) || first_name.length < 2) {
      return res.status(400).json({ error: 'Please enter a valid first name (letters only, at least 2 characters)' });
    }
    if (!NAME_RE.test(last_name) || last_name.length < 2) {
      return res.status(400).json({ error: 'Please enter a valid last name (letters only, at least 2 characters)' });
    }
    if (email && (email.length > 255 || !EMAIL_RE.test(email))) {
      return res.status(400).json({ error: 'That email address doesn\'t look valid — check it or leave it empty' });
    }
    if (phone && (!PHONE_RE.test(phone) || (phone.match(/\d/g) || []).length < 7)) {
      return res.status(400).json({ error: 'That phone number doesn\'t look valid — check it or leave it empty' });
    }
    if (company.length > 150) {
      return res.status(400).json({ error: 'Company name is too long (150 characters max)' });
    }
    if (purpose.length > 300) {
      return res.status(400).json({ error: 'Purpose of visit is too long (300 characters max)' });
    }
    if (vehicle_plate && !/^[A-Z0-9\s-]{2,20}$/.test(vehicle_plate)) {
      return res.status(400).json({ error: 'Vehicle plate: letters, numbers and dashes only' });
    }
    // ─── END INPUT VALIDATION ───

    // ─── NDA: when the org requires it, a signature must accompany check-in ───
    if (orgSettings.require_nda) {
      // Fail fast with a clear message if the migration hasn't been run yet
      try {
        await db.query('SELECT 1 FROM nda_signatures LIMIT 1');
      } catch (probeErr) {
        if (probeErr.code === '42P01') {
          return res.status(500).json({ error: 'NDA table missing — run the NDA migration in Render PSQL (migration-nda.txt)' });
        }
      }
      if (!nda_signature) {
        return res.status(400).json({ error: 'This organization requires visitors to sign an NDA before entry', nda_required: true });
      }
    }
    // ─── END NDA ───

    // ─── AUTO-LINK: kiosk check-in without QR -> match a pre-registration ───
    let linkedPreRegId = pre_reg_id;
    if (!linkedPreRegId) {
      try {
        const prMatch = await db.query(
          `SELECT id FROM pre_registered_visitors
           WHERE org_id = $1
             AND (LOWER(email) = LOWER($2) OR (LOWER(first_name) = LOWER($3) AND LOWER(last_name) = LOWER($4)))
             AND invitation_status IN ('pending','sent','opened')
           ORDER BY expected_date DESC LIMIT 1`,
          [org_id, email || '', first_name, last_name]
        );
        if (prMatch.rows.length > 0) {
          linkedPreRegId = prMatch.rows[0].id;
        }
      } catch (mErr) {
        console.error('Pre-reg auto-match failed (continuing):', mErr);
      }
    }
    // ─── END AUTO-LINK ───

    // ─── DUPLICATE GUARD: one active visit per visitor per org ───
    try {
      let dupQuery, dupParams;
      if (linkedPreRegId) {
        dupQuery = `SELECT * FROM visits WHERE org_id = $1 AND status = 'checked_in' AND pre_reg_id = $2 ORDER BY checked_in_at DESC LIMIT 1`;
        dupParams = [org_id, linkedPreRegId];
      } else if (email) {
        dupQuery = `SELECT * FROM visits WHERE org_id = $1 AND status = 'checked_in' AND LOWER(visitor_email) = LOWER($2) ORDER BY checked_in_at DESC LIMIT 1`;
        dupParams = [org_id, email];
      } else {
        dupQuery = `SELECT * FROM visits WHERE org_id = $1 AND status = 'checked_in' AND LOWER(visitor_first_name) = LOWER($2) AND LOWER(visitor_last_name) = LOWER($3) ORDER BY checked_in_at DESC LIMIT 1`;
        dupParams = [org_id, first_name, last_name];
      }
      const dup = await db.query(dupQuery, dupParams);
      if (dup.rows.length > 0) {
        const existing = dup.rows[0];
        return res.json({ ...existing, already_checked_in: true, message: `Already checked in — badge ${existing.badge_number}` });
      }
    } catch (dupErr) {
      console.error('Duplicate check failed (continuing):', dupErr);
    }
    // ─── END DUPLICATE GUARD ───

    const cap = await checkVisitCap(org_id);
    if (!cap.allowed) {
      return res.status(429).json({ error: `Monthly visit limit reached (${cap.cap}). Please contact the front desk — the organization needs to upgrade its plan.`, code: 'VISIT_CAP' });
    }

    // ─── VISITOR FLAGS: staff watchlist / blacklist (migration-visitor-alerts) ───
    // Blacklisted visitors are refused at the door with a neutral message
    // (never reveal WHY — that's private staff information).
    const visitorFlags = await getFlagsForVisitor(org_id, email, first_name, last_name);
    const blacklisted = visitorFlags.find(f => f.severity === 'blacklist');
    if (blacklisted) {
      return res.status(403).json({
        error: 'This visitor is not permitted on site. Please see the front desk.',
        code: 'VISITOR_BLACKLISTED'
      });
    }
    // ─── END VISITOR FLAGS ───

    const date = new Date();
    const badgeNum = `${date.getFullYear().toString().substr(2)}${(date.getMonth()+1).toString().padStart(2,'0')}${date.getDate().toString().padStart(2,'0')}-${Math.floor(1000 + Math.random() * 9000)}`;

    const withDevice = await hasDeviceColumn();
    const deviceId = withDevice ? await resolveDevice(org_id, device_id) : null;
    let deviceName = null;
    let devicePrint = false;
    if (deviceId) {
      try {
        const dn = await db.query('SELECT name, print_badge FROM devices WHERE id = $1', [deviceId]);
        if (dn.rows[0]) { deviceName = dn.rows[0].name; devicePrint = dn.rows[0].print_badge === true; }
      } catch (e) {
        if (e.code === '42703') {
          try {
            const dn = await db.query('SELECT name FROM devices WHERE id = $1', [deviceId]);
            deviceName = dn.rows[0] ? dn.rows[0].name : null;
          } catch (e2) { if (e2.code !== '42P01' && e2.code !== '42703') throw e2; }
        } else if (e.code !== '42P01') throw e;
      }
    }
    // Auto-print: org master switch (Settings) AND this kiosk has a printer linked (Devices)
    const shouldPrintBadge = (orgSettings?.auto_print_badge === true) && devicePrint === true;
    // Suggested (fallback) visitor types carry no DB id — keep the chosen name
    // inside custom_data so the visit record still shows what was picked
    const customDataOut = { ...(custom_data || {}) };
    if (!visitor_type_id && req.body.visitor_type_name) {
      customDataOut.visitor_type = String(req.body.visitor_type_name).slice(0, 60);
    }
    const result = await db.query(withDevice ? `
      INSERT INTO visits (
        org_id, pre_reg_id, visitor_type_id, host_id,
        visitor_first_name, visitor_last_name, visitor_email, visitor_phone, visitor_company,
        purpose, badge_number, vehicle_plate, custom_data, sign_in_method, photo_data, status, device_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'checked_in', $16)
      RETURNING *
    ` : `
      INSERT INTO visits (
        org_id, pre_reg_id, visitor_type_id, host_id,
        visitor_first_name, visitor_last_name, visitor_email, visitor_phone, visitor_company,
        purpose, badge_number, vehicle_plate, custom_data, sign_in_method, photo_data, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'checked_in')
      RETURNING *
    `, withDevice
      ? [org_id, linkedPreRegId || null, visitor_type_id, host_id, first_name, last_name, email, phone, company, purpose, badgeNum, vehicle_plate, JSON.stringify(customDataOut), sign_in_method, photo_data || null, deviceId]
      : [org_id, linkedPreRegId || null, visitor_type_id, host_id, first_name, last_name, email, phone, company, purpose, badgeNum, vehicle_plate, JSON.stringify(customDataOut), sign_in_method, photo_data || null]);

    const visit = result.rows[0];

    // Store the signed NDA linked to this visit (with a snapshot of the exact text signed)
    if (orgSettings.require_nda && nda_signature) {
      try {
        await db.query(
          `INSERT INTO nda_signatures (org_id, visit_id, visitor_name, visitor_email, signed_name, signature_data, document_text)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            org_id,
            visit.id,
            `${first_name} ${last_name}`,
            email || null,
            (nda_signed_name || `${first_name} ${last_name}`).slice(0, 255),
            nda_signature,
            orgSettings.nda_text || DEFAULT_NDA_TEXT,
          ]
        );
      } catch (ndaErr) {
        // The visit is already created — log loudly but don't break check-in
        console.error('NDA signature save failed:', ndaErr);
      }
    }

    // Mark the pre-registration as arrived
    if (linkedPreRegId) {
      try {
        await db.query("UPDATE pre_registered_visitors SET invitation_status = 'checked_in' WHERE id = $1", [linkedPreRegId]);
      } catch (preErr) {
        console.error('Failed to update pre-registration status:', preErr);
      }
    }

    // Notify host (wrap in try/catch so notification failure doesn't break check-in)
    if (host_id) {
      try {
        const hostResult = await db.query('SELECT * FROM hosts WHERE id = $1', [host_id]);
        if (hostResult.rows.length > 0) {
          const host = hostResult.rows[0];

          if ((orgSettings.notify_email ?? true) && host.notify_email && host.email) {
            try {
              await sendEmail({
                to: host.email,
                subject: `Visitor Arrived: ${first_name} ${last_name}`,
                html: `
                  <h2>Your visitor has arrived</h2>
                  <p><strong>Name:</strong> ${first_name} ${last_name}</p>
                  <p><strong>Company:</strong> ${company || 'N/A'}</p>
                  <p><strong>Purpose:</strong> ${purpose || 'N/A'}</p>
                  <p><strong>Badge #:</strong> ${badgeNum}</p>
                  <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
                `
              });
            } catch (emailErr) {
              console.log('Email notification failed (no SMTP configured):', emailErr.message);
            }
          }

          if ((orgSettings.notify_sms ?? true) && host.notify_sms && host.phone) {
            try {
              await sendSMS({
                to: host.phone,
                body: `Visitor arrived: ${first_name} ${last_name} from ${company || 'N/A'}. Badge: ${badgeNum}`
              });
            } catch (smsErr) {
              console.log('SMS notification failed (no Twilio configured):', smsErr.message);
            }
          }

          await db.query('UPDATE visits SET host_notified_at = NOW() WHERE id = $1', [visit.id]);
        }
      } catch (notifyErr) {
        console.log('Host notification failed:', notifyErr.message);
      }
    }

    // Date of birth from an ID scan (hospitals etc.) — stored when the column exists
    if (req.body.visitor_dob) {
      const dob = new Date(req.body.visitor_dob);
      if (!isNaN(dob.getTime())) {
        try {
          await db.query('UPDATE visits SET visitor_dob = $1 WHERE id = $2', [dob.toISOString().slice(0, 10), visit.id]);
          visit.visitor_dob = dob.toISOString().slice(0, 10);
        } catch (e) { if (e.code !== '42703') throw e; }
      }
    }

    // Teams card (no await on purpose beyond the helper's own safety)
    let teamHostName = null;
    if (host_id) {
      try {
        const hr = await db.query('SELECT first_name, last_name FROM hosts WHERE id = $1', [host_id]);
        if (hr.rows[0]) teamHostName = `${hr.rows[0].first_name} ${hr.rows[0].last_name}`;
      } catch (e) { /* optional detail — never block check-in */ }
    }
    notifyGenericWebhook(org_id, 'visitor.checkin', {
      visit_id: visit.id,
      first_name, last_name,
      email: email || null,
      phone: phone || null,
      company: company || null,
      purpose: purpose || null,
      host: teamHostName,
      badge_number: badgeNum,
      kiosk: deviceName,
      checked_in_at: visit.checked_in_at,
    });
    notifyTeams(org_id, `New visitor: ${first_name} ${last_name}`, [
      ['Host', teamHostName],
      ['Company', company],
      ['Purpose', purpose],
      ['Badge', badgeNum],
      ['Kiosk', deviceName || null],
      ['Time', new Date().toLocaleString()],
    ]).catch(() => {});

    res.status(201).json({
      success: true,
      visit: visit,
      badge_number: badgeNum,
      print_badge: shouldPrintBadge,
      // Only the severity reaches the kiosk so staff get a heads-up —
      // the note text itself stays private to the admin dashboard.
      flag_severity: visitorFlags[0]?.severity || null,
      message: 'Check-in successful'
    });
  } catch (err) {
    console.error('Check-in error:', err.message);
    console.error('Stack:', err.stack);
    res.status(500).json({ error: 'Check-in failed', details: err.message });
  }
});

router.post('/:id/check-out', authenticate, requirePermission('visits'), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const result = await db.query(`
      UPDATE visits 
      SET status = 'checked_out', checked_out_at = NOW(), checked_out_by = $2, check_out_notes = $3
      WHERE id = $1 AND org_id = $4 AND status = 'checked_in'
      RETURNING *
    `, [id, req.user.id, notes, req.user.org_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Visit not found or already checked out' });
    }

    const checkedOutVisit = result.rows[0];
    if (checkedOutVisit.pre_reg_id) {
      try {
        await db.query("UPDATE pre_registered_visitors SET invitation_status = 'checked_out' WHERE id = $1", [checkedOutVisit.pre_reg_id]);
      } catch (preErr) {
        console.error('Failed to update pre-registration status:', preErr);
      }
    }
    res.json({ success: true, visit: checkedOutVisit });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Check-out failed' });
  }
});

// GET /api/visits/alerts/today — security/secretary alert feed for the dashboard:
//  - staff: employees who badge-scanned in today and have a photo or staff note on file
//  - flagged: visitors checked in today who are on the watchlist/blacklist (note included —
//    this endpoint is staff-only, notes never reach the public kiosk)
router.get('/alerts/today', authenticate, requirePermission('visits'), async (req, res) => {
  try {
    const staff = await db.query(
      `SELECT v.id AS visit_id, v.checked_in_at, h.first_name, h.last_name,
              h.photo_data AS photo, h.notes AS note, h.department
       FROM visits v
       JOIN hosts h ON h.org_id = v.org_id
         AND LOWER(h.email) = LOWER(v.visitor_email)
       WHERE v.org_id = $1 AND v.sign_in_method = 'staff_qr'
         AND v.checked_in_at >= CURRENT_DATE
         AND (h.photo_data IS NOT NULL OR (h.notes IS NOT NULL AND h.notes <> ''))
       ORDER BY v.checked_in_at DESC`,
      [req.user.org_id]
    );

    let flagged = { rows: [] };
    try {
      flagged = await db.query(
        `SELECT v.id AS visit_id, v.checked_in_at, v.visitor_first_name, v.visitor_last_name,
                v.visitor_email, v.visitor_company, f.note, f.severity
         FROM visits v
         JOIN visitor_flags f ON f.org_id = v.org_id AND f.is_active = true AND (
           (f.visitor_email IS NOT NULL AND f.visitor_email <> ''
              AND LOWER(f.visitor_email) = LOWER(v.visitor_email))
           OR
           (f.visitor_first_name IS NOT NULL AND f.visitor_last_name IS NOT NULL
              AND LOWER(f.visitor_first_name) = LOWER(v.visitor_first_name)
              AND LOWER(f.visitor_last_name)  = LOWER(v.visitor_last_name))
         )
         WHERE v.org_id = $1 AND v.checked_in_at >= CURRENT_DATE
         ORDER BY v.checked_in_at DESC`,
        [req.user.org_id]
      );
    } catch (e) {
      if (e.code !== '42P01' && e.code !== '42703') throw e; // flags migration not run — flagged feed just stays empty
    }

    res.json({ staff: staff.rows, flagged: flagged.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load alerts' });
  }
});

router.get('/:id', authenticate, requirePermission('visits'), async (req, res) => {
  try {
    const result = await db.query(`
      SELECT v.*, 
        h.first_name as host_first_name, h.last_name as host_last_name,
        vt.name as visitor_type_name
      FROM visits v
      LEFT JOIN hosts h ON v.host_id = h.id
      LEFT JOIN visitor_types vt ON v.visitor_type_id = vt.id
      WHERE v.id = $1 AND v.org_id = $2
    `, [req.params.id, req.user.org_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Visit not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch visit' });
  }
});

module.exports = router;
