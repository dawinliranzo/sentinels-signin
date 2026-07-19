const express = require('express');
const rateLimit = require('express-rate-limit');
const { sendEmail } = require('../utils/notifications');

const router = express.Router();

// Stricter limit for this public endpoint: 10 requests per hour per IP
const accessRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Too many requests. Please try again later or email info@sentinelsit.com directly.' }
});

const escapeHtml = (s) => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/access-requests — public "Request Access" form from the marketing site
router.post('/', accessRequestLimiter, async (req, res) => {
  try {
    const { name, email, company, team_size, plan } = req.body || {};

    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
    if (!email || !EMAIL_RE.test(String(email).trim())) return res.status(400).json({ error: 'A valid email is required' });
    if (!company || !String(company).trim()) return res.status(400).json({ error: 'Company is required' });
    if (String(name).length > 120 || String(company).length > 160 || String(email).length > 160) {
      return res.status(400).json({ error: 'Input too long' });
    }

    const n = escapeHtml(name.trim());
    const e = escapeHtml(email.trim());
    const c = escapeHtml(company.trim());
    const ts = escapeHtml((team_size || '—').toString().trim());
    const p = escapeHtml((plan || 'Not sure yet').toString().trim());
    const when = new Date().toUTCString();

    const notifyTo = process.env.ACCESS_REQUEST_EMAIL || 'info@sentinelsit.com';

    // 1) Notify the SentinelsIT team
    const notifyResult = await sendEmail({
      to: notifyTo,
      subject: `New access request — ${c} (${n})`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
          <div style="background:#0F172A;color:#fff;padding:18px 24px;border-radius:12px 12px 0 0">
            <h2 style="margin:0;font-size:18px">🔔 New Access Request</h2>
          </div>
          <div style="border:1px solid #E2E8F0;border-top:none;padding:24px;border-radius:0 0 12px 12px">
            <table style="width:100%;border-collapse:collapse;font-size:14px">
              <tr><td style="padding:8px 0;color:#64748B;width:130px">Name</td><td style="padding:8px 0;font-weight:600">${n}</td></tr>
              <tr><td style="padding:8px 0;color:#64748B">Email</td><td style="padding:8px 0"><a href="mailto:${e}">${e}</a></td></tr>
              <tr><td style="padding:8px 0;color:#64748B">Company</td><td style="padding:8px 0;font-weight:600">${c}</td></tr>
              <tr><td style="padding:8px 0;color:#64748B">Team size</td><td style="padding:8px 0">${ts}</td></tr>
              <tr><td style="padding:8px 0;color:#64748B">Interested plan</td><td style="padding:8px 0">${p}</td></tr>
              <tr><td style="padding:8px 0;color:#64748B">Submitted</td><td style="padding:8px 0">${when}</td></tr>
            </table>
            <p style="margin:20px 0 0;font-size:13px;color:#64748B">Reply directly to the requester at <a href="mailto:${e}">${e}</a>, then create their organization from the Super Admin panel.</p>
          </div>
        </div>`
    });

    // 2) Confirmation to the requester
    await sendEmail({
      to: email.trim(),
      subject: 'We received your Sentinels Sign-In request ✓',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
          <div style="background:#0D7377;color:#fff;padding:18px 24px;border-radius:12px 12px 0 0">
            <h2 style="margin:0;font-size:18px">Thanks, ${n}! 🛡️</h2>
          </div>
          <div style="border:1px solid #E2E8F0;border-top:none;padding:24px;border-radius:0 0 12px 12px;font-size:14px;color:#1E293B">
            <p>We've received your request for <strong>Sentinels Sign-In</strong> access for <strong>${c}</strong>.</p>
            <p>Our team will reach out within <strong>one business day</strong> with your login details and next steps for setting up your kiosk.</p>
            <p style="color:#64748B;font-size:13px;margin-top:24px">Questions in the meantime? Just reply to this email.</p>
            <p style="margin:24px 0 0">— The SentinelsIT Team<br><span style="color:#64748B;font-size:12px">sentinelskiosk.com</span></p>
          </div>
        </div>`
    });

    if (notifyResult && notifyResult.simulated) {
      console.log('Access request (email simulated):', { name: n, email: e, company: c, team_size: ts, plan: p });
    }

    res.status(201).json({ success: true });
  } catch (err) {
    console.error('Access request error:', err);
    res.status(500).json({ error: 'Failed to submit request' });
  }
});

module.exports = router;
