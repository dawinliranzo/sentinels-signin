const express = require('express');
const QRCode = require('qrcode');
const router = express.Router();
const db = require('../utils/db');
const { authenticate } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const { sendEmail } = require('../utils/notifications');

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


// Build a QR PNG attachment for invitation emails
const buildQrAttachment = async (token) => {
  const url = `${process.env.FRONTEND_URL || 'https://www.sentinelskiosk.com'}/check-in/${token}`;
  const dataUrl = await QRCode.toDataURL(url, { width: 400, margin: 1 });
  return {
    filename: 'visit-qr.png',
    content: dataUrl.split(';base64,').pop(),
    encoding: 'base64',
    cid: 'visitqr'
  };
};

router.post('/', authenticate, async (req, res) => {
  try {
    const { first_name, last_name, email, phone, company, host_id, visitor_type_id, purpose, expected_date, expected_time_start, expected_time_end } = req.body;

    // Generate QR code token
    const qrToken = uuidv4();
    const qrExpires = new Date();
    qrExpires.setDate(qrExpires.getDate() + 7); // QR valid for 7 days

    const result = await db.query(
      `INSERT INTO pre_registered_visitors (org_id, first_name, last_name, email, phone, company, host_id, visitor_type_id, purpose, expected_date, expected_time_start, expected_time_end, qr_code, qr_expires_at, invitation_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'sent') RETURNING *`,
      [req.user.org_id, first_name, last_name, email, phone, company, host_id, visitor_type_id, purpose, expected_date, expected_time_start, expected_time_end, qrToken, qrExpires]
    );

    const preReg = result.rows[0];

    // Try to send invitation email
    if (email) {
      try {
        const hostResult = await db.query('SELECT * FROM hosts WHERE id = $1', [host_id]);
        const hostName = hostResult.rows[0] ? `${hostResult.rows[0].first_name} ${hostResult.rows[0].last_name}` : 'your host';

        const qrAttachment = await buildQrAttachment(qrToken);
        await sendEmail({
          to: email,
          subject: `You're invited to visit ${req.user.org_name || 'our office'}`,
          attachments: [qrAttachment],
          html: `
            <h2>Hello ${first_name},</h2>
            <p>You have been pre-registered for a visit.</p>
            <p><strong>Date:</strong> ${expected_date}</p>
            <p><strong>Time:</strong> ${expected_time_start} - ${expected_time_end}</p>
            <p><strong>Host:</strong> ${hostName}</p>
            <p><strong>Purpose:</strong> ${purpose || 'N/A'}</p>
            <p><strong>When you arrive:</strong> show this QR code at the kiosk to check in instantly — no typing needed:</p>
            <p><img src="cid:visitqr" alt="Your visit QR code" width="200" style="display:block"/></p>
            <p>You can also tap this link on your phone instead:</p>
            <p><a href="${process.env.FRONTEND_URL || 'https://www.sentinelskiosk.com'}/check-in/${qrToken}">
              ${process.env.FRONTEND_URL || 'https://www.sentinelskiosk.com'}/check-in/${qrToken}
            </a></p>
            <p>This QR code is valid until ${qrExpires.toLocaleDateString()}.</p>
          `
        });

        await db.query('UPDATE pre_registered_visitors SET invitation_sent_at = NOW() WHERE id = $1', [preReg.id]);
      } catch (emailErr) {
        console.log('Email send failed (no SMTP):', emailErr.message);
        // Still create the pre-registration, just mark as pending
        await db.query("UPDATE pre_registered_visitors SET invitation_status = 'pending' WHERE id = $1", [preReg.id]);
      }
    }

    res.status(201).json(preReg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create pre-registration' });
  }
});

// UPDATE pre-registration
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { first_name, last_name, email, phone, company, host_id, visitor_type_id, purpose, expected_date, expected_time_start, expected_time_end } = req.body;

    // Empty strings break Postgres uuid/date/time columns — convert to null
    const clean = (v) => (v === '' || v === undefined ? null : v);

    const result = await db.query(
      `UPDATE pre_registered_visitors 
       SET first_name = $1, last_name = $2, email = $3, phone = $4, company = $5, 
           host_id = $6, visitor_type_id = $7, purpose = $8, expected_date = $9, 
           expected_time_start = $10, expected_time_end = $11
       WHERE id = $12 AND org_id = $13 RETURNING *`,
      [first_name, last_name, email, clean(phone), clean(company), clean(host_id), clean(visitor_type_id), clean(purpose), clean(expected_date), clean(expected_time_start), clean(expected_time_end), req.params.id, req.user.org_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pre-registration not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update pre-registration', details: err.message });
  }
});

// DELETE pre-registration
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const result = await db.query(
      'DELETE FROM pre_registered_visitors WHERE id = $1 AND org_id = $2 RETURNING id',
      [req.params.id, req.user.org_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pre-registration not found' });
    }

    res.json({ success: true, message: 'Pre-registration deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete pre-registration' });
  }
});

// RESEND invitation
router.post('/:id/resend', authenticate, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM pre_registered_visitors WHERE id = $1 AND org_id = $2',
      [req.params.id, req.user.org_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pre-registration not found' });
    }

    const preReg = result.rows[0];

    // Generate new QR code
    const newQrToken = uuidv4();
    const newQrExpires = new Date();
    newQrExpires.setDate(newQrExpires.getDate() + 7);

    await db.query(
      'UPDATE pre_registered_visitors SET qr_code = $1, qr_expires_at = $2, invitation_status = $3 WHERE id = $4',
      [newQrToken, newQrExpires, 'sent', preReg.id]
    );

    // Try to send email
    if (preReg.email) {
      try {
        const hostResult = await db.query('SELECT * FROM hosts WHERE id = $1', [preReg.host_id]);
        const hostName = hostResult.rows[0] ? `${hostResult.rows[0].first_name} ${hostResult.rows[0].last_name}` : 'your host';

        const qrAttachment = await buildQrAttachment(newQrToken);
        await sendEmail({
          to: preReg.email,
          subject: `Reminder: Your visit invitation`,
          attachments: [qrAttachment],
          html: `
            <h2>Hello ${preReg.first_name},</h2>
            <p>This is a reminder about your upcoming visit.</p>
            <p><strong>Date:</strong> ${preReg.expected_date}</p>
            <p><strong>Time:</strong> ${preReg.expected_time_start} - ${preReg.expected_time_end}</p>
            <p><strong>Host:</strong> ${hostName}</p>
            <p><strong>When you arrive:</strong> show this QR code at the kiosk to check in instantly:</p>
            <p><img src="cid:visitqr" alt="Your visit QR code" width="200" style="display:block"/></p>
            <p>You can also tap this link on your phone instead:</p>
            <p><a href="${process.env.FRONTEND_URL || 'https://www.sentinelskiosk.com'}/check-in/${newQrToken}">
              ${process.env.FRONTEND_URL || 'https://www.sentinelskiosk.com'}/check-in/${newQrToken}
            </a></p>
          `
        });

        await db.query('UPDATE pre_registered_visitors SET invitation_sent_at = NOW() WHERE id = $1', [preReg.id]);
      } catch (emailErr) {
        console.log('Email resend failed:', emailErr.message);
      }
    }

    res.json({ success: true, message: 'Invitation resent', qr_code: newQrToken });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to resend invitation' });
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
       WHERE pr.qr_code = $1 AND pr.qr_expires_at > NOW()`,
      [req.params.token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid or expired QR code' });
    }

    const visitor = result.rows[0];

    // Update status to opened if it's pending or sent
    if (visitor.invitation_status !== 'used') {
      await db.query("UPDATE pre_registered_visitors SET invitation_status = 'opened' WHERE id = $1", [visitor.id]);
    }

    res.json({ valid: true, visitor: visitor });
  } catch (err) {
    res.status(500).json({ error: 'Failed to validate QR code' });
  }
});

module.exports = router;
