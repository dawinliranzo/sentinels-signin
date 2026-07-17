const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { authenticate } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

router.get('/', authenticate, async (req, res) => {
  try {
    const { date } = req.query;
    let query = `
      SELECT pr.*, h.first_name as host_first_name, h.last_name as host_last_name, vt.name as visitor_type_name
      FROM pre_registered_visitors pr
      LEFT JOIN hosts h ON pr.host_id = h.id
      LEFT JOIN visitor_types vt ON pr.visitor_type_id = vt.id
      WHERE pr.org_id = $1
    `;
    const params = [req.user.org_id];

    if (date) {
      query += ` AND pr.expected_date = $2`;
      params.push(date);
    }

    query += ` ORDER BY pr.expected_date DESC, pr.expected_time_start DESC`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pre-registered visitors' });
  }
});

router.post('/', authenticate, async (req, res) => {
  try {
    const { first_name, last_name, email, phone, company, host_id, visitor_type_id, purpose, expected_date, expected_time_start, expected_time_end } = req.body;

    // Generate QR code token
    const qrToken = uuidv4();
    const qrExpires = new Date();
    qrExpires.setDate(qrExpires.getDate() + 7); // QR valid for 7 days

    const result = await db.query(
      `INSERT INTO pre_registered_visitors (org_id, first_name, last_name, email, phone, company, host_id, visitor_type_id, purpose, expected_date, expected_time_start, expected_time_end, qr_code, qr_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [req.user.org_id, first_name, last_name, email, phone, company, host_id, visitor_type_id, purpose, expected_date, expected_time_start, expected_time_end, qrToken, qrExpires]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create pre-registration' });
  }
});

// Validate QR code for contactless sign-in
router.get('/validate-qr/:token', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT pr.*, h.first_name as host_first_name, h.last_name as host_last_name, vt.name as visitor_type_name
       FROM pre_registered_visitors pr
       LEFT JOIN hosts h ON pr.host_id = h.id
       LEFT JOIN visitor_types vt ON pr.visitor_type_id = vt.id
       WHERE pr.qr_code = $1 AND pr.qr_expires_at > NOW() AND pr.invitation_status IN ('sent', 'opened')`,
      [req.params.token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid or expired QR code' });
    }

    res.json({ valid: true, visitor: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to validate QR code' });
  }
});

module.exports = router;
