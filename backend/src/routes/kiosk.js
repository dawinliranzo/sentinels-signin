const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { sendEmail } = require('../utils/notifications');

// In-memory kiosk status per org. Note: resets if the server restarts —
// worst case is one missed or repeated alert, which is acceptable for v1.
const kioskStatus = new Map(); // orgId -> { lastSeen, alertSent }

const OFFLINE_AFTER_MS = 10 * 60 * 1000; // alert after 10 min without heartbeat
const CHECK_EVERY_MS = 5 * 60 * 1000;    // scan every 5 min

// POST /api/kiosk/heartbeat — public, org-scoped (called by the kiosk UI every 60s)
router.post('/heartbeat', async (req, res) => {
  try {
    const { org_id, device_id } = req.body;
    if (!org_id) {
      return res.status(400).json({ error: 'org_id is required' });
    }

    const orgCheck = await db.query('SELECT id, name, status FROM organizations WHERE id = $1', [org_id]);
    if (orgCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid organization' });
    }

    const entry = kioskStatus.get(org_id);
    const wasOffline = entry && entry.alertSent;

    kioskStatus.set(org_id, { lastSeen: Date.now(), alertSent: false });

    // If the kiosk is a paired device, stamp its last_seen (drives the online status in Devices)
    if (device_id) {
      db.query('UPDATE devices SET last_seen_at = NOW() WHERE id = $1 AND org_id = $2 AND is_active = true', [device_id, org_id])
        .catch((e) => console.error('Device last_seen update failed:', e.message));
    }

    // Recovery: notify admins the kiosk is back
    if (wasOffline) {
      notifyAdmins(org_id, orgCheck.rows[0].name, true).catch(err => console.error('Recovery email failed:', err));
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Heartbeat error:', err);
    res.status(500).json({ error: 'Heartbeat failed' });
  }
});

async function notifyAdmins(orgId, orgName, isRecovery) {
  const admins = await db.query(
    `SELECT email, first_name FROM users 
     WHERE org_id = $1 AND role IN ('admin', 'super_admin') AND notify_offline = true AND is_active = true`,
    [orgId]
  );

  for (const admin of admins.rows) {
    if (isRecovery) {
      await sendEmail({
        to: admin.email,
        subject: `Kiosk back online — ${orgName}`,
        html: `<p>Hi ${admin.first_name},</p>
               <p>Good news: your Sentinels Sign-In kiosk is <strong>back online</strong> — heartbeats are being received again.</p>
               <p>— Sentinels Sign-In</p>`
      });
    } else {
      await sendEmail({
        to: admin.email,
        subject: `Kiosk offline — ${orgName}`,
        html: `<p>Hi ${admin.first_name},</p>
               <p>Your Sentinels Sign-In kiosk has <strong>not checked in for over 10 minutes</strong>. Visitors may be unable to sign in right now.</p>
               <p>Please check:</p>
               <ul>
                 <li>The kiosk device is powered on</li>
                 <li>Wi-Fi / internet is connected</li>
                 <li>The browser is open on the kiosk page</li>
               </ul>
               <p>You'll receive another email when it comes back online.</p>
               <p>— Sentinels Sign-In</p>`
      });
    }
  }
}

// Periodic scan: flag orgs whose kiosk went quiet
setInterval(async () => {
  const now = Date.now();
  for (const [orgId, entry] of kioskStatus.entries()) {
    if (!entry.alertSent && now - entry.lastSeen > OFFLINE_AFTER_MS) {
      try {
        const orgRes = await db.query('SELECT name FROM organizations WHERE id = $1', [orgId]);
        await notifyAdmins(orgId, orgRes.rows[0]?.name || 'your organization', false);
        console.log(`Offline alert sent for org ${orgId}`);
      } catch (err) {
        console.error('Offline alert failed:', err);
      }
      kioskStatus.set(orgId, { ...entry, alertSent: true });
    }
  }
}, CHECK_EVERY_MS);

// GET /api/kiosk/config/:orgId — public, minimal kiosk configuration
router.get('/config/:orgId', async (req, res) => {
  try {
    const r = await db.query('SELECT name, settings FROM organizations WHERE id = $1', [req.params.orgId]);
    if (r.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid organization' });
    }
    const s = r.rows[0].settings || {};
    res.json({
      org_name: r.rows[0].name,
      photo_required: !!(s.require_photo || s.photo_required),
      nda_required: !!s.require_nda,
      nda_text: s.nda_text || '',
      logo_data: s.logo_data || '',
      custom_fields: Array.isArray(s.custom_fields) ? s.custom_fields : [],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load kiosk config' });
  }
});

module.exports = router;
