const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { authenticate } = require('../middleware/auth');
const { sendEmail, sendSMS } = require('../utils/notifications');

// GET active visits (who's on-site now)
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

// GET visit history with filters
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

// POST new check-in (from kiosk or web)
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
      pre_reg_id
    } = req.body;

    // Generate badge number (e.g., 0427)
    const date = new Date();
    const badgeNum = `${date.getFullYear().toString().substr(2)}${(date.getMonth()+1).toString().padStart(2,'0')}${date.getDate().toString().padStart(2,'0')}-${Math.floor(1000 + Math.random() * 9000)}`;

    const result = await db.query(`
      INSERT INTO visits (
        org_id, pre_reg_id, visitor_type_id, host_id,
        visitor_first_name, visitor_last_name, visitor_email, visitor_phone, visitor_company,
        purpose, badge_number, vehicle_plate, custom_data, sign_in_method, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'checked_in')
      RETURNING *
    `, [org_id, pre_reg_id || null, visitor_type_id, host_id, first_name, last_name, email, phone, company, purpose, badgeNum, vehicle_plate, JSON.stringify(custom_data || {}), sign_in_method]);

    const visit = result.rows[0];

    // Notify host (wrap in try/catch so notification failure doesn't break check-in)
    if (host_id) {
      try {
        const hostResult = await db.query('SELECT * FROM hosts WHERE id = $1', [host_id]);
        if (hostResult.rows.length > 0) {
          const host = hostResult.rows[0];

          if (host.notify_email && host.email) {
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

          if (host.notify_sms && host.phone) {
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

// POST check-out
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

    res.json({ success: true, visit: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Check-out failed' });
  }
});

// GET single visit
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
