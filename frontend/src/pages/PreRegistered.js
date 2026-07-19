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
      SELECT pr.*, h.first_name as host_first_name, h.last_name as host_last_name, vt.name as visitor_type_name,
        (SELECT v.status FROM visits v WHERE v.pre_reg_id = pr.id ORDER BY v.checked_in_at DESC LIMIT 1) AS live_visit_status
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

    query += ` ORDER BY pr.expected_date DESC NULLS LAST, pr.expected_time_start DESC NULLS LAST, pr.created_at DESC`;

    const result = await db.query(query, params);

    // Visits are the source of truth: if a linked visit exists, derive the real status from it
    // (self-heals any status that a missed update or QR re-validation left behind)
    const rows = result.rows.map((r) => {
      let real = r.invitation_status;
      if (r.live_visit_status === 'checked_in') real = 'checked_in';
      else if (r.live_visit_status === 'checked_out') real = 'checked_out';
      if (real !== r.invitation_status) {
        db.query('UPDATE pre_registered_visitors SET invitation_status = $1 WHERE id = $2', [real, r.id])
          .catch((e) => console.error('Status self-heal failed:', e.message));
      }
      const { live_visit_status, ...rest } = r;
      return { ...rest, invitation_status: real };
    });
    res.json(rows);
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

    // Empty strings break Postgres uuid/date/time columns — convert to null
    const clean = (v) => (v === '' || v === undefined ? null : v);

    // Dates are optional by default; the org can require them via Settings
    const orgRes = await db.query('SELECT settings FROM organizations WHERE id = $1', [req.user.org_id]);
    const orgSettings = (orgRes.rows[0] && orgRes.rows[0].settings) || {};
    if (orgSettings.require_prereg_date && !clean(expected_date)) {
      return res.status(400).json({ error: 'Expected date is required by your organization settings' });
    }

    // Generate QR code token
    const qrToken = uuidv4();
    const qrExpires = new Date();
    qrExpires.setDate(qrExpires.getDate() + 7); // QR valid for 7 days

    const result = await db.query(
      `INSERT INTO pre_registered_visitors (org_id, first_name, last_name, email, phone, company, host_id, visitor_type_id, purpose, expected_date, expected_time_start, expected_time_end, qr_code, qr_expires_at, invitation_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'sent') RETURNING *`,
      [req.user.org_id, first_name, last_name, clean(email), clean(phone), clean(company), clean(host_id), clean(visitor_type_id), clean(purpose), clean(expected_date), clean(expected_time_start), clean(expected_time_end), qrToken, qrExpires]
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
            <p><strong>Date:</strong> ${expected_date || 'Flexible — any day'}</p>
            ${expected_time_start ? `<p><strong>Time:</strong> ${expected_time_start}${expected_time_end ? ' - ' + expected_time_end : ''}</p>` : ''}
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

    // Dates are optional by default; the org can require them via Settings
    const orgRes = await db.query('SELECT settings FROM organizations WHERE id = $1', [req.user.org_id]);
    const orgSettings = (orgRes.rows[0] && orgRes.rows[0].settings) || {};
    if (orgSettings.require_prereg_date && !clean(expected_date)) {
      return res.status(400).json({ error: 'Expected date is required by your organization settings' });
    }

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

    const resendStatus = ['checked_in', 'checked_out'].includes(preReg.invitation_status) ? preReg.invitation_status : 'sent';
    await db.query(
      'UPDATE pre_registered_visitors SET qr_code = $1, qr_expires_at = $2, invitation_status = $3 WHERE id = $4',
      [newQrToken, newQrExpires, resendStatus, preReg.id]
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
            <p><strong>Date:</strong> ${preReg.expected_date || 'Flexible — any day'}</p>
            ${preReg.expected_time_start ? `<p><strong>Time:</strong> ${preReg.expected_time_start}${preReg.expected_time_end ? ' - ' + preReg.expected_time_end : ''}</p>` : ''}
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

    // Only advance pending/sent -> opened. Never downgrade someone already checked in/out
    // (the QR gets re-validated on every link refresh — this must not reset their status)
    if (['pending', 'sent'].includes(visitor.invitation_status)) {
      await db.query("UPDATE pre_registered_visitors SET invitation_status = 'opened' WHERE id = $1", [visitor.id]);
    }

    res.json({ valid: true, visitor: visitor });
  } catch (err) {
    res.status(500).json({ error: 'Failed to validate QR code' });
  }
});

module.exports = router;
