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
               <p>Good news: your Sentinels Kiosk kiosk is <strong>back online</strong> — heartbeats are being received again.</p>
               <p>— Sentinels Kiosk</p>`
      });
    } else {
      await sendEmail({
        to: admin.email,
        subject: `Kiosk offline — ${orgName}`,
        html: `<p>Hi ${admin.first_name},</p>
               <p>Your Sentinels Kiosk kiosk has <strong>not checked in for over 10 minutes</strong>. Visitors may be unable to sign in right now.</p>
               <p>Please check:</p>
               <ul>
                 <li>The kiosk device is powered on</li>
                 <li>Wi-Fi / internet is connected</li>
                 <li>The browser is open on the kiosk page</li>
               </ul>
               <p>You'll receive another email when it comes back online.</p>
               <p>— Sentinels Kiosk</p>`
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
      profile_type: s.profile_type || 'other',
      id_scan_enabled: s.id_scan_enabled === true,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load kiosk config' });
  }
});

// ── ID scan (OCR) ─────────────────────────────────────────────────────────────
// Best-effort extraction of first name, last name and date of birth from a photo
// of a government ID. The kiosk always shows the parsed fields for confirmation —
// OCR is an assistant, not an authority.

function parseDob(text) {
  // MM/DD/YYYY or MM-DD-YYYY (US licenses)
  let m = text.match(/\b(0[1-9]|1[0-2])[\/.\- ](0[1-9]|[12]\d|3[01])[\/.\- ]((19|20)\d{2})\b/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  // YYYY-MM-DD (ISO, passports / some IDs)
  m = text.match(/\b((19|20)\d{2})[\/.\- ](0[1-9]|1[0-2])[\/.\- ](0[1-9]|[12]\d|3[01])\b/);
  if (m) return `${m[1]}-${m[3]}-${m[4]}`;
  // DD MMM YYYY (e.g. 12 JAN 1990)
  const months = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
  m = text.match(/\b([012]?\d|3[01])\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+((19|20)\d{2})\b/i);
  if (m) return `${m[3]}-${months[m[2].toUpperCase()]}-${m[1].padStart(2, '0')}`;
  return null;
}

function parseName(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 1);
  let last = null, first = null;
  // Labelled fields: "LN SMITH" / "FN JOHN" / "Last: Smith" — or the label alone
  // on one line with the value on the next (passport-style)
  const isNameLine = (v) => v && /^[A-Za-z''.\- ]{2,}$/.test(v) && !/(LICENSE|LICENCIA|PASSPORT|STATE|UNITED|USA|DATE|BIRTH|SEX|EXP|ISS|OF|THE)/i.test(v);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // Bare label with the value on the next line (passport-style)
    if (/^(LN|LAST( NAME)?|SURNAME|APELLIDO)\.?$/i.test(l) && isNameLine(lines[i + 1]) && !last) { last = lines[i + 1].trim(); continue; }
    if (/^(FN|FIRST( NAME)?|GIVEN( NAMES)?|NOMBRE)\.?$/i.test(l) && isNameLine(lines[i + 1]) && !first) { first = lines[i + 1].trim(); continue; }
    // Inline label: "LN SMITH" / "FN JOHN" / "Last: Smith"
    let m = l.match(/^(LN|LAST|SURNAME|APELLIDO)[:\s]+([A-Z''\- ]{2,})$/i);
    if (m && !last) last = m[2].trim().split(/\s{2,}/)[0];
    m = l.match(/^(FN|FIRST|GIVEN|NOMBRE)[:\s]+([A-Z''\- ]{2,})$/i);
    if (m && !first) first = m[2].trim().split(/\s{2,}/)[0];
  }
  // "SMITH, JOHN" on one line
  if (!first || !last) {
    const m = text.match(/\b([A-Z][A-Z''\-]{2,}),\s*([A-Z][A-Z''\-]{2,})\b/);
    if (m) { if (!last) last = m[1]; if (!first) first = m[2]; }
  }
  // Fallback: first two fully-uppercase alpha lines that aren't keywords
  if (!first || !last) {
    const skip = /(DRIVER|LICENSE|LICENCIA|STATE|USA|UNITED|ID|CARD|DOB|BIRTH|SEX|EXP|ISS|CLASS|RESTRICTION|ENDORSEMENT|HEIGHT|WEIGHT|EYES|HAIR|ADDRESS|DONOR|VETERAN|ESTADOS|AMERICA|OF|THE|AND)/i;
    const caps = lines.filter((l) => /^[A-Z][A-Z''.\- ]+$/.test(l) && !skip.test(l) && l.replace(/\s/g, '').length >= 2);
    if (!last && caps.length >= 1) last = caps[0];
    if (!first && caps.length >= 2) first = caps[1];
  }
  const clean = (v) => (v ? v.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).trim() : null);
  return { first_name: clean(first), last_name: clean(last) };
}

// PUBLIC: scan an ID at the kiosk → { first_name, last_name, dob }
// Only runs when the org enabled it (Settings → Kiosk → ID scan).
router.post('/scan-id', async (req, res) => {
  try {
    const { org_id, image } = req.body;
    if (!org_id || !image) return res.status(400).json({ error: 'Organization ID and image are required' });

    const org = await db.query('SELECT settings FROM organizations WHERE id = $1', [org_id]);
    const st = (org.rows[0] && org.rows[0].settings) || {};
    if (st.id_scan_enabled !== true) {
      return res.status(403).json({ error: 'ID scan is not enabled for this organization' });
    }

    const b64 = String(image).replace(/^data:image\/\w+;base64,/, '');
    if (b64.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'Image too large' });
    const buffer = Buffer.from(b64, 'base64');

    let text = '';
    try {
      const { createWorker } = require('tesseract.js');
      const worker = await createWorker('eng');
      const r = await worker.recognize(buffer);
      text = r.data.text || '';
      await worker.terminate();
    } catch (e) {
      console.error('OCR failed:', e.message);
      return res.status(503).json({ error: 'ID scanning is unavailable right now — please type your details' });
    }

    const { first_name, last_name } = parseName(text);
    const dob = parseDob(text);
    res.json({ first_name, last_name, dob, found: !!(first_name || last_name || dob) });
  } catch (err) {
    console.error('Scan ID error:', err);
    res.status(500).json({ error: 'Failed to scan ID' });
  }
});

module.exports = router;
