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
      hidden_fields: Array.isArray(s.hidden_fields) ? s.hidden_fields : [],
      profile_type: s.profile_type || 'other',
      id_scan_enabled: s.id_scan_enabled === true,
      // Date of birth is a STANDARD kiosk field, off by default except for the
      // hospital profile (its historical behavior) — null = org never chose,
      // the kiosk applies the profile default; true/false = org's explicit choice
      dob_enabled: typeof s.dob_enabled === 'boolean' ? s.dob_enabled : null,
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
  // Real-world OCR of an ID glues the label to the date ("oBO1/16/1985") and
  // confuses letters for digits (O→0, l→1, S→5). Dates never contain letters,
  // so every pattern runs against a digit-normalized copy of the text.
  const original = String(text).toUpperCase();
  const norm = original
    .replace(/[OQ]/g, '0')
    .replace(/[IL|!]/g, '1')
    .replace(/S(?=\d)|(?<=\d)S/g, '5');
  const now = Date.now();
  const candidates = [];
  // Loose label check (tie-breaker only): is something DOB-ish just before
  // the date? OCR mangles "DOB" into "oB"/"D0B"/"08", so stay permissive.
  const anchoredNear = (idx) => /(DOB|D0B|BIRTH|BORN|DBB|O0B|0B|OB)/.test(original.slice(Math.max(0, idx - 20), idx));
  const push = (y, m, d, idx) => {
    y = +y; m = +m; d = +d;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return;
    // A date of birth is after 1900 and never in the future — this alone
    // eliminates expiry dates (future) and most issue dates get sorted below
    if (y < 1900 || dt.getTime() > now) return;
    candidates.push({ y, m, d, t: dt.getTime(), anchored: anchoredNear(idx) });
  };
  // MM/DD/YYYY or MM-DD-YYYY (US licenses) — no \b before the month: the label
  // is usually glued to it, and a letter before a digit breaks \b
  for (const m of norm.matchAll(/(?<!\d)(0[1-9]|1[0-2])[\/.\- ]([0-2]\d|3[01])[\/.\- ]((?:19|20)\d{2})(?!\d)/g))
    push(m[3], m[1], m[2], m.index);
  // YYYY-MM-DD (ISO, passports / some IDs)
  for (const m of norm.matchAll(/(?<!\d)((?:19|20)\d{2})[\/.\- ](0[1-9]|1[0-2])[\/.\- ]([0-2]\d|3[01])(?!\d)/g))
    push(m[1], m[2], m[3], m.index);
  // DD MMM YYYY (e.g. 12 JAN 1990) — English and Spanish month names.
  // Runs on the ORIGINAL text: digit-normalizing would mangle "AGO" → "AG0".
  const months = { JAN: '01', ENE: '01', FEB: '02', MAR: '03', APR: '04', ABR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', AGO: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12', DIC: '12' };
  for (const m of original.matchAll(/(?<![\dA-Z])([012]?\d|3[01])\s+(JAN|ENE|FEB|MAR|APR|ABR|MAY|JUN|JUL|AUG|AGO|SEP|OCT|NOV|DEC|DIC)[A-Z]*\s+((?:19|20)\d{2})(?!\d)/g))
    push(m[3], months[m[2]], m[1], m.index);
  if (candidates.length === 0) return null;
  // Prefer the date sitting next to a DOB/BIRTH label; otherwise the earliest
  // plausible date wins — issue dates are recent, expiry dates are future
  // (already filtered), so the birth date is the oldest one on the card.
  const pick = candidates.find(c => c.anchored)
    || candidates.slice().sort((a, b) => a.t - b.t)[0];
  return `${pick.y}-${String(pick.m).padStart(2, '0')}-${String(pick.d).padStart(2, '0')}`;
}

function parseName(text) {
  const lines = String(text).split('\n').map((l) => l.trim()).filter((l) => l.length > 1);
  let last = null, first = null;
  // Words that look name-ish but are card chrome, addresses or field labels.
  // Anything containing a digit is never a name (kills "1234 PALM LN").
  const SKIP = /(DRIVER|LICEN|PASSPORT|STATE|UNITED|USA|AMERICA|ESTADOS|DEPARTMENT|MOTOR|VEHICLE|IDENT|CARD|DOB|BIRTH|BORN|SEX|EXP|ISS|CLASS|RESTR|ENDORSE|HEIGHT|WEIGHT|HGT|WGT|EYES|HAIR|ADDR|STREET|AVENUE|DRIVE|ROAD|LANE|DONOR|VETERAN|ORGAN|ARIZONA|CALIFORNIA|TEXAS|FLORIDA|NEVADA|OHIO|MICHIGAN|WASHINGTON|COLORADO|ILLINOIS|PENNSYLVANIA|\bNEW\s|\bOF\b|\bTHE\b|\bAND\b|\d)/i;
  const clean = (v) => {
    if (!v) return null;
    const c = v.replace(/[^A-Za-z''\- ]/g, '').trim().replace(/\s+/g, ' ');
    if (c.length < 2 || c.length > 40 || SKIP.test(c)) return null;
    return c.toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());
  };
  const isNameValue = (v) => !!clean(v);
  // 1. Labelled fields — "LN SMITH" / "FN JOHN" / "Last: Smith" inline, or a
  // bare label with the value on the next line (passport-style)
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^(LN|LAST( NAME)?|SURNAME|APELLIDO)\.?$/i.test(l) && isNameValue(lines[i + 1]) && !last) { last = clean(lines[i + 1]); continue; }
    if (/^(FN|FIRST( NAME)?|GIVEN( NAMES)?|NOMBRE)\.?$/i.test(l) && isNameValue(lines[i + 1]) && !first) { first = clean(lines[i + 1]); continue; }
    let m = l.match(/(?:^|\s)(LN|LAST|SURNAME|APELLIDO)[:\s.]+(.+)$/i);
    if (m && !last) {
      // The value may swallow the next label: "LN SMYTHE FN JANE"
      const emb = m[2].match(/^(.*?)\s+(?:FN|FIRST|GIVEN|NOMBRE)[:\s.]+(.+)$/i);
      last = clean(emb ? emb[1] : m[2]);
      if (emb && !first) first = clean(emb[2]);
    }
    m = l.match(/(?:^|\s)(FN|FIRST|GIVEN|NOMBRE)[:\s.]+(.+)$/i);
    if (m && !first) {
      const emb = m[2].match(/^(.*?)\s+(?:LN|LAST|SURNAME|APELLIDO)[:\s.]+(.+)$/i);
      first = clean(emb ? emb[1] : m[2]);
      if (emb && !last) last = clean(emb[2]);
    }
  }
  // 2. "SMITH, JOHN" — OCR just as often renders the comma as a period
  if (!first || !last) {
    for (const l of lines) {
      const m = l.match(/^([A-Z][A-Z''\-]{2,}(?:\s[A-Z][A-Z''\-]{2,})?)[,\.;]\s*([A-Z][A-Z''\-]{1,}(?:\s[A-Z][A-Z''\-]{1,})?)$/);
      if (m && !SKIP.test(m[1]) && !SKIP.test(m[2])) {
        if (!last) last = clean(m[1]);
        if (!first) first = clean(m[2]);
        if (last && first) break;
      }
    }
  }
  // 3. Fallback: first fully-uppercase alpha lines that aren't card chrome —
  // the name block usually sits above the address on US licenses
  if (!first || !last) {
    const caps = [];
    for (const l of lines) {
      const t = l.replace(/[^A-Za-z''\- ]/g, '').trim();
      if (/^[A-Z][A-Z''\- ]+$/.test(t) && t.length >= 2 && t.length <= 40 && !SKIP.test(t)) caps.push(t);
    }
    if (!last && caps.length >= 1) last = clean(caps[0]);
    if (!first && caps.length >= 2) first = clean(caps[1]);
  }
  return { first_name: first, last_name: last };
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
      const { createWorker, PSM } = require('tesseract.js');
      const worker = await createWorker('eng');
      // Sparse text mode: kiosk captures are full webcam frames with the ID
      // held up in a scene, not a clean cropped document
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
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
