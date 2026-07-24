const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { checkVisitCap } = require('../utils/limits');
const { getFlagsForVisitor } = require('./flags');
const { sendEmail, sendSMS } = require('../utils/notifications');

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
    const { org_id, host_id } = req.body;
    if (!org_id || !host_id) {
      return res.status(400).json({ error: 'org_id and host_id are required' });
    }

    const hostRes = await db.query(
      'SELECT * FROM hosts WHERE id = $1 AND org_id = $2 AND is_active = true',
      [host_id, org_id]
    );
    if (hostRes.rows.length === 0) {
      return res.status(404).json({ error: 'Badge not recognized for this kiosk' });
    }
    const host = hostRes.rows[0];
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
    const ins = await db.query(
      `INSERT INTO visits (org_id, visitor_type_id, host_id, visitor_first_name, visitor_last_name, visitor_email, visitor_phone, visitor_company, purpose, badge_number, sign_in_method, status, checked_in_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'staff_qr', 'checked_in', NOW()) RETURNING *`,
      [org_id, null, null, host.first_name, host.last_name, staffEmail, host.phone || null, host.department || 'Staff', 'Employee check-in', badgeNum]
    );

    res.json({
      action: 'checked_in',
      name: host.first_name,
      photo: host.photo_data || null,
      notes: host.notes || null,
      badge: ins.rows[0].badge_number,
      visit: ins.rows[0]
    });
  } catch (err) {
    console.error('Staff check-in error:', err);
    res.status(500).json({ error: 'Staff check-in failed', details: err.message });
  }
});

// PUBLIC: frequent-visitor badge scan — toggles that person's visit in/out.
// The kiosk sends { org_id, code } from the FV-XXXXX QR (scanned as "FV:FV-XXXXX").
router.post('/fv-checkin', async (req, res) => {
  try {
    const { org_id, code } = req.body;
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
    const ins = await db.query(
      `INSERT INTO visits (org_id, visitor_type_id, host_id, visitor_first_name, visitor_last_name, visitor_email, visitor_phone, visitor_company, purpose, badge_number, sign_in_method, status, checked_in_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'qr', 'checked_in', NOW()) RETURNING *`,
      [org_id, null, null, fvRow.first_name, fvRow.last_name, fvRow.email || null, fvRow.phone || null, fvRow.company || null, 'Frequent visit', badgeNum]
    );
    res.json({ action: 'checked_in', name: fvRow.first_name, code: fvRow.code, badge: ins.rows[0].badge_number, visit: ins.rows[0] });
  } catch (err) {
    console.error('FV check-in error:', err);
    res.status(500).json({ error: 'Badge scan failed', details: err.message });
  }
});

// AUTHENTICATED ENDPOINTS
router.get('/active', authenticate, requirePermission('visits'), async (req, res) => {
  try {
    const result = await db.query(`
      SELECT v.*, 
        h.first_name as host_first_name, h.last_name as host_last_name, h.email as host_email, h.phone as host_phone,
        vt.name as visitor_type_name, vt.badge_color
      FROM visits v
      LEFT JOIN hosts h ON v.host_id = h.id
      LEFT JOIN visitor_types vt ON v.visitor_type_id = vt.id
      WHERE v.org_id = $1 AND v.status = 'checked_in'
      ORDER BY v.checked_in_at DESC
    `, [req.user.org_id]);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch active visits' });
  }
});

router.get('/', authenticate, requirePermission('visits'), async (req, res) => {
  try {
    const { date, status, host_id, search, from, to } = req.query;
    let query = `
      SELECT v.*, 
        h.first_name as host_first_name, h.last_name as host_last_name,
        vt.name as visitor_type_name
      FROM visits v
      LEFT JOIN hosts h ON v.host_id = h.id
      LEFT JOIN visitor_types vt ON v.visitor_type_id = vt.id
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
      nda_signed_name
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

    const result = await db.query(`
      INSERT INTO visits (
        org_id, pre_reg_id, visitor_type_id, host_id,
        visitor_first_name, visitor_last_name, visitor_email, visitor_phone, visitor_company,
        purpose, badge_number, vehicle_plate, custom_data, sign_in_method, photo_data, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'checked_in')
      RETURNING *
    `, [org_id, linkedPreRegId || null, visitor_type_id, host_id, first_name, last_name, email, phone, company, purpose, badgeNum, vehicle_plate, JSON.stringify(custom_data || {}), sign_in_method, photo_data || null]);

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

    res.status(201).json({
      success: true,
      visit: visit,
      badge_number: badgeNum,
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
           ((f.visitor_email IS NULL OR f.visitor_email = '')
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
