const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { authenticate } = require('../middleware/auth');
const { sendEmail, sendSMS } = require('../utils/notifications');

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
      return res.json({ action: 'checked_out', name: host.first_name, visit: out.rows[0] });
    }

    const date = new Date();
    const badgeNum = `${String(date.getFullYear()).slice(2)}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;
    const ins = await db.query(
      `INSERT INTO visits (org_id, visitor_type_id, host_id, visitor_first_name, visitor_last_name, visitor_email, visitor_phone, visitor_company, purpose, badge_number, sign_in_method, status, checked_in_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'staff_qr', 'checked_in', NOW()) RETURNING *`,
      [org_id, null, null, host.first_name, host.last_name, staffEmail, host.phone || null, host.department || 'Staff', 'Employee check-in', badgeNum]
    );

    res.json({ action: 'checked_in', name: host.first_name, badge: ins.rows[0].badge_number, visit: ins.rows[0] });
  } catch (err) {
    console.error('Staff check-in error:', err);
    res.status(500).json({ error: 'Staff check-in failed', details: err.message });
  }
});

// AUTHENTICATED ENDPOINTS
router.get('/active', authenticate, async (req, res) => {
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

router.get('/', authenticate, async (req, res) => {
  try {
    const { date, status, host_id, search } = req.query;
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
      query += ` AND (v.visitor_first_name ILIKE $${paramCount} OR v.visitor_last_name ILIKE $${paramCount} OR v.visitor_email ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY v.checked_in_at DESC LIMIT 500`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch visits' });
  }
});

router.post('/check-in', async (req, res) => {
  try {
    const {
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
      photo_data
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
      message: 'Check-in successful'
    });
  } catch (err) {
    console.error('Check-in error:', err.message);
    console.error('Stack:', err.stack);
    res.status(500).json({ error: 'Check-in failed', details: err.message });
  }
});

router.post('/:id/check-out', authenticate, async (req, res) => {
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

router.get('/:id', authenticate, async (req, res) => {
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
