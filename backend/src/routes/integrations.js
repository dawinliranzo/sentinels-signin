// UniFi Protect integration — camera-driven auto check-in/out.
//
// How it works:
//   1. Org admin enables the integration in Settings → UniFi Protect and copies
//      the per-org webhook URL shown there.
//   2. In the UniFi console (Protect → Settings → System → Webhooks, or an Alarm
//      rule) they add that URL for smart-detection events on door cameras.
//   3. Protect fires an event when a person is seen. On AI-capable cameras with
//      Known Faces enrolled, the event carries the person's name — we match it
//      to a host or a pre-registered visitor and sign them in or out
//      automatically. Unknown faces are logged as 'unidentified' so the front
//      desk has a record of every door event.
//
// The webhook is unauthenticated by design (Protect cannot sign requests);
// security is the per-org random secret embedded in the URL. Secrets rotate
// from Settings. Every payload is stored raw in unifi_events for audit.
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../utils/db');
const { authenticate, requirePermission, requireFeature } = require('../middleware/auth');
const { raiseSecurityAlert, recentAlertExists } = require('../utils/security');

const APP_API = process.env.PUBLIC_API_URL || 'https://api.sentinelskiosk.com/api';

const getSettings = async (orgId) => {
  const r = await db.query('SELECT settings FROM organizations WHERE id = $1', [orgId]);
  return (r.rows[0] && r.rows[0].settings) || {};
};

// ── Tailgating detector (Settings → UniFi Protect → "Tailgating alerts") ──
// A camera sees people BEFORE they reach the kiosk, so the comparison must be
// delayed: when a person event arrives we wait `windowMin` minutes, then count
// over that trailing window —
//   seen      = camera person-events that represent ENTRIES (auto check-ins +
//               unrecognized faces; exits and "already on site" re-sightings
//               are excluded)
//   checkedIn = visit rows created in the same window (any method — kiosk,
//               QR, badge tap, camera auto check-in; companions included)
// seen > checkedIn means bodies walked in without a matching check-in: alert.
// One alert per org per 10 minutes (cooldown) so a busy door can't spam.
function scheduleTailgateCheck(orgId, cameraName, windowMin) {
  setTimeout(async () => {
    try {
      const seen = await db.query(
        `SELECT COUNT(*)::int AS n FROM unifi_events
         WHERE org_id = $1 AND action IN ('checked_in', 'unidentified')
           AND created_at > NOW() - ($2 || ' minutes')::interval`,
        [orgId, String(windowMin)]
      );
      const checkedIn = await db.query(
        `SELECT COUNT(*)::int AS n FROM visits
         WHERE org_id = $1 AND checked_in_at > NOW() - ($2 || ' minutes')::interval`,
        [orgId, String(windowMin)]
      );
      const e = seen.rows[0].n, v = checkedIn.rows[0].n;
      if (e <= v) return;
      if (await recentAlertExists(orgId, 'tailgating', 'detector', 'unifi', 10)) return;
      await raiseSecurityAlert(orgId, 'tailgating',
        `Possible tailgating near ${cameraName || 'a door camera'}: cameras counted ${e} ${e === 1 ? 'person' : 'people'} entering in the last ${windowMin} min, but only ${v} check-in${v === 1 ? '' : 's'} recorded.`,
        { detector: 'unifi', camera: cameraName, seen: e, checked_in: v, window_minutes: windowMin });
    } catch (err) {
      if (err.code !== '42P01') console.error('Tailgate check failed:', err.message);
    }
  }, Math.max(1, windowMin) * 60 * 1000).unref?.();
  // .unref: a pending tailgate check must never keep the process alive
}

const logEvent = async (orgId, camera, personName, direction, action, detail) => {
  try {
    await db.query(
      'INSERT INTO unifi_events (org_id, camera, person_name, direction, action, detail) VALUES ($1,$2,$3,$4,$5,$6)',
      [orgId, camera || null, personName || null, direction || null, action, JSON.stringify(detail || {})]
    );
  } catch (e) {
    if (e.code !== '42P01') console.error('unifi event log failed:', e.message);
  }
};

// Recursively hunt for the camera name and the recognized person's name in
// whatever payload shape this Protect firmware sends (they vary by version).
const findField = (obj, keys, depth = 0) => {
  if (!obj || typeof obj !== 'object' || depth > 6) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (keys.includes(k.toLowerCase()) && typeof v === 'string' && v.trim()) return v.trim();
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const hit = findField(v, keys, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
};
const extractCamera = (p) =>
  findField(p, ['cameraname', 'camera_name', 'devicename', 'device_name', 'source']) ||
  findField(p.camera && typeof p.camera === 'object' ? p.camera : {}, ['name', 'id']) ||
  findField(p, ['camera', 'device', 'cameraid', 'deviceid']) || null;
const extractPerson = (p) =>
  findField(p, ['facename', 'face_name', 'personname', 'person_name', 'visitorname']) ||
  findField(p.face && typeof p.face === 'object' ? p.face : {}, ['name', 'label']) ||
  findField(p.person && typeof p.person === 'object' ? p.person : {}, ['name', 'label']) || null;

// ---------- Webhook (no auth — secret in URL) ----------
router.post('/unifi/webhook/:orgId/:secret', async (req, res) => {
  // Always 200 quickly-ish: Protect retries on failure and we never want a queue
  // of duplicate door events. Bad configs get a 200 + an ignored event row.
  try {
    const { orgId, secret } = req.params;
    const settings = await getSettings(orgId);
    const cfg = settings.unifi || {};
    if (!cfg.enabled || !cfg.secret || cfg.secret !== secret) {
      return res.json({ ok: true, ignored: 'webhook disabled or secret mismatch' });
    }
    const payload = req.body || {};
    const cameraName = extractCamera(payload);
    const personName = extractPerson(payload);

    // Map the camera to a direction (default 'both' when unmapped so a single
    // door camera toggles people in and out)
    const camCfg = (cfg.cameras || []).find(c =>
      c.name && cameraName && c.name.toLowerCase() === cameraName.toLowerCase());
    const direction = camCfg ? camCfg.direction : 'both';

    // Tailgating detector: an entry-side person event starts a delayed
    // camera-vs-check-ins comparison (delayed so the person has time to walk
    // from the door to the kiosk and sign in). Exits never trigger it.
    if (cfg.tailgate_alerts === true && cameraName && direction !== 'out') {
      scheduleTailgateCheck(orgId, cameraName, parseInt(cfg.tailgate_window_minutes, 10) || 3);
    }

    if (!personName) {
      await logEvent(orgId, cameraName, null, direction, 'unidentified', payload);
      return res.json({ ok: true, action: 'unidentified' });
    }

    // 1) Someone with this name already on site?
    const open = await db.query(
      `SELECT * FROM visits WHERE org_id = $1 AND status = 'checked_in'
         AND LOWER(visitor_first_name || ' ' || COALESCE(visitor_last_name,'')) = LOWER($2)
       ORDER BY checked_in_at DESC LIMIT 1`,
      [orgId, personName]
    );
    if (open.rows.length > 0) {
      if (direction === 'in') {
        await logEvent(orgId, cameraName, personName, direction, 'ignored', { reason: 'already on site', ...payload });
        return res.json({ ok: true, action: 'ignored', reason: 'already on site' });
      }
      const out = await db.query(
        `UPDATE visits SET status = 'checked_out', checked_out_at = NOW(),
           check_out_notes = 'Auto check-out — UniFi Protect camera' WHERE id = $1 RETURNING id`,
        [open.rows[0].id]
      );
      await logEvent(orgId, cameraName, personName, direction, 'checked_out', { visit_id: out.rows[0].id, ...payload });
      return res.json({ ok: true, action: 'checked_out', person: personName });
    }

    if (direction === 'out') {
      await logEvent(orgId, cameraName, personName, direction, 'ignored', { reason: 'exit with no open visit', ...payload });
      return res.json({ ok: true, action: 'ignored', reason: 'exit with no open visit' });
    }

    // 2) A host (staff) with this name? → staff check-in
    const host = await db.query(
      `SELECT * FROM hosts WHERE org_id = $1 AND is_active = true
         AND LOWER(first_name || ' ' || COALESCE(last_name,'')) = LOWER($2) LIMIT 1`,
      [orgId, personName]
    );
    // 3) Otherwise a pre-registered visitor expected today
    const prereg = host.rows.length === 0
      ? await db.query(
          `SELECT * FROM pre_registered_visitors WHERE org_id = $1
             AND LOWER(first_name || ' ' || COALESCE(last_name,'')) = LOWER($2)
             AND expected_date = CURRENT_DATE
             AND COALESCE(invitation_status, '') NOT IN ('cancelled', 'checked_in')
           ORDER BY created_at DESC LIMIT 1`,
          [orgId, personName]
        )
      : { rows: [] };

    if (host.rows.length === 0 && prereg.rows.length === 0) {
      await logEvent(orgId, cameraName, personName, direction, 'unidentified', payload);
      return res.json({ ok: true, action: 'unidentified', person: personName });
    }

    // Monthly visit cap — same rule as every other sign-in path
    try {
      const capOrg = await db.query('SELECT max_visits_per_month FROM organizations WHERE id = $1', [orgId]);
      const cap = capOrg.rows[0] && capOrg.rows[0].max_visits_per_month;
      if (cap) {
        const used = await db.query(
          `SELECT COUNT(*)::int AS n FROM visits WHERE org_id = $1 AND checked_in_at >= DATE_TRUNC('month', CURRENT_DATE)`,
          [orgId]
        );
        if (used.rows[0].n >= cap) {
          await logEvent(orgId, cameraName, personName, direction, 'ignored', { reason: 'visit cap reached', ...payload });
          return res.json({ ok: true, action: 'ignored', reason: 'monthly visit cap reached' });
        }
      }
    } catch (e) { if (e.code !== '42703') throw e; }

    const d = new Date();
    const badgeNum = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

    let ins;
    if (host.rows.length > 0) {
      const h = host.rows[0];
      ins = await db.query(
        `INSERT INTO visits (org_id, visitor_type_id, host_id, visitor_first_name, visitor_last_name, visitor_email, visitor_phone, visitor_company, purpose, badge_number, sign_in_method, status, checked_in_at)
         VALUES ($1, null, null, $2, $3, $4, $5, $6, $7, $8, 'unifi_face', 'checked_in', NOW()) RETURNING id, badge_number`,
        [orgId, h.first_name, h.last_name, h.email || null, h.phone || null, h.department || 'Staff', 'Employee check-in (camera)', badgeNum]
      );
    } else {
      const v = prereg.rows[0];
      ins = await db.query(
        `INSERT INTO visits (org_id, visitor_type_id, host_id, visitor_first_name, visitor_last_name, visitor_email, visitor_phone, visitor_company, purpose, badge_number, sign_in_method, status, checked_in_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'unifi_face', 'checked_in', NOW()) RETURNING id, badge_number`,
        [orgId, v.visitor_type_id || null, v.host_id || null, v.first_name, v.last_name, v.email || null, v.phone || null, v.company || null, v.purpose || 'Pre-registered (camera)', badgeNum]
      );
      try {
        await db.query(
          `UPDATE pre_registered_visitors SET invitation_status = 'checked_in', checked_in_at = NOW() WHERE id = $1`,
          [v.id]
        );
      } catch (e) { if (e.code !== '42703') throw e; }
    }
    await logEvent(orgId, cameraName, personName, direction, 'checked_in', { visit_id: ins.rows[0].id, badge: ins.rows[0].badge_number, ...payload });
    res.json({ ok: true, action: 'checked_in', person: personName, badge: ins.rows[0].badge_number });
  } catch (err) {
    console.error('UniFi webhook error:', err);
    res.json({ ok: false }); // still 200 — Protect must not retry a poison payload
  }
});

// ---------- Org config (authenticated, feature-gated) ----------
// GET config + the exact URL to paste into the UniFi console
router.get('/unifi/config', authenticate, requirePermission('settings'), requireFeature('unifi'), async (req, res) => {
  try {
    const settings = await getSettings(req.user.org_id);
    const cfg = settings.unifi || {};
    res.json({
      enabled: cfg.enabled === true,
      secret: cfg.secret || null,
      cameras: Array.isArray(cfg.cameras) ? cfg.cameras : [],
      tailgate_alerts: cfg.tailgate_alerts === true,
      tailgate_window_minutes: parseInt(cfg.tailgate_window_minutes, 10) || 3,
      webhook_url: cfg.secret ? `${APP_API}/integrations/unifi/webhook/${req.user.org_id}/${cfg.secret}` : null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load UniFi config' });
  }
});

// Save config: enable/disable + camera→direction mapping. Generates the secret
// on first enable. JSONB merge — never wipes other settings keys.
router.put('/unifi/config', authenticate, requirePermission('settings'), requireFeature('unifi'), async (req, res) => {
  try {
    const enabled = req.body && req.body.enabled === true;
    const cameras = Array.isArray(req.body && req.body.cameras)
      ? req.body.cameras
          .filter(c => c && typeof c.name === 'string' && c.name.trim())
          .slice(0, 20)
          .map(c => ({ name: c.name.trim(), direction: ['in', 'out', 'both'].includes(c.direction) ? c.direction : 'both' }))
      : [];
    const settings = await getSettings(req.user.org_id);
    const existing = settings.unifi || {};
    // Tailgating alerts: absent keys keep their previous values so older
    // frontends (or partial saves) never silently turn the detector off
    const tgWindow = parseInt(req.body && req.body.tailgate_window_minutes, 10);
    const merged = {
      enabled,
      cameras,
      secret: existing.secret || crypto.randomBytes(24).toString('hex'),
      tailgate_alerts: typeof (req.body && req.body.tailgate_alerts) === 'boolean'
        ? req.body.tailgate_alerts
        : existing.tailgate_alerts === true,
      tailgate_window_minutes: Number.isInteger(tgWindow) && tgWindow >= 1 && tgWindow <= 15
        ? tgWindow
        : (parseInt(existing.tailgate_window_minutes, 10) || 3),
    };
    await db.query(
      `UPDATE organizations SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('unifi', $1::jsonb) WHERE id = $2`,
      [JSON.stringify(merged), req.user.org_id]
    );
    res.json({ ...merged, webhook_url: `${APP_API}/integrations/unifi/webhook/${req.user.org_id}/${merged.secret}` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save UniFi config' });
  }
});

// Rotate the webhook secret (old URL stops working immediately)
router.post('/unifi/config/regenerate-secret', authenticate, requirePermission('settings'), requireFeature('unifi'), async (req, res) => {
  try {
    const settings = await getSettings(req.user.org_id);
    const merged = { ...(settings.unifi || {}), secret: crypto.randomBytes(24).toString('hex') };
    await db.query(
      `UPDATE organizations SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('unifi', $1::jsonb) WHERE id = $2`,
      [JSON.stringify(merged), req.user.org_id]
    );
    res.json({ ...merged, webhook_url: `${APP_API}/integrations/unifi/webhook/${req.user.org_id}/${merged.secret}` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to rotate secret' });
  }
});

// Recent door events for the Settings → UniFi activity log
router.get('/unifi/events', authenticate, requirePermission('settings'), requireFeature('unifi'), async (req, res) => {
  try {
    const r = await db.query(
      'SELECT id, camera, person_name, direction, action, created_at FROM unifi_events WHERE org_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.user.org_id]
    );
    res.json(r.rows);
  } catch (e) {
    if (e.code === '42P01') return res.status(500).json({ error: 'UniFi events table missing — run migration-unifi.txt in Render PSQL first' });
    console.error(e);
    res.status(500).json({ error: 'Failed to load events' });
  }
});

module.exports = router;
