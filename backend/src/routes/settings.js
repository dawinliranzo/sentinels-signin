const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { authenticate, requirePermission, requireFeature, loadOrg } = require('../middleware/auth');
const { sendSMS } = require('../utils/notifications');

// GET /api/settings — this organization's settings (any logged-in user)
router.get('/', authenticate, requirePermission('settings'), async (req, res) => {
  try {
    const r = await db.query('SELECT settings FROM organizations WHERE id = $1', [req.user.org_id]);
    res.json(r.rows[0]?.settings || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load settings', details: err.message });
  }
});

// PATCH /api/settings — replace this organization's settings (admins only).
// Registration-form customization (custom_fields + hidden_fields) is core
// product, available to every plan — earlier versions silently dropped
// custom_fields for free orgs, which looked like "save does nothing".
router.patch('/', authenticate, requirePermission('settings'), async (req, res) => {
  try {
    const body = { ...(req.body || {}) };
    // Org profile drives terminology across the app — whitelist the known types
    if ('profile_type' in body) {
      const allowed = ['business', 'building', 'hospital', 'school', 'other'];
      if (!allowed.includes(body.profile_type)) delete body.profile_type;
    }
    // Standard kiosk fields the org chose to hide — whitelist the hideable set
    // (first/last name, host and visitor type are structural and can never hide)
    if ('hidden_fields' in body) {
      const HIDEABLE = ['email', 'phone', 'company', 'purpose', 'vehicle_plate', 'photo'];
      body.hidden_fields = Array.isArray(body.hidden_fields)
        ? body.hidden_fields.filter(k => HIDEABLE.includes(k))
        : [];
    }
    const r = await db.query(
      'UPDATE organizations SET settings = $1 WHERE id = $2 RETURNING settings',
      [JSON.stringify(body), req.user.org_id]
    );
    res.json(r.rows[0].settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save settings', details: err.message });
  }
});

// POST /api/settings/test-sms — send a test text to verify Twilio configuration (admins only)
router.post('/test-sms', authenticate, requirePermission('settings'), requireFeature('sms'), async (req, res) => {
  try {
    const phone = (req.body.phone || '').trim();
    if (!phone) {
      return res.status(400).json({ error: 'Phone number required (include country code, e.g. +1347...)' });
    }
    const org = await db.query('SELECT name FROM organizations WHERE id = $1', [req.user.org_id]);
    const result = await sendSMS({
      to: phone,
      body: `Sentinels Kiosk: test SMS from ${org.rows[0]?.name || 'your organization'}. Text alerts are working!`,
    });
    if (result.simulated) {
      return res.json({ ok: false, simulated: true, message: 'Twilio is not configured on the server yet (missing TWILIO_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER env vars on Render)' });
    }
    if (!result.success) {
      return res.json({ ok: false, message: `Twilio rejected it: ${result.error}` });
    }
    res.json({ ok: true, message: `Test SMS sent to ${phone}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send test SMS' });
  }
});

// POST /api/settings/test-teams — send a test card to the configured Teams webhook
router.post('/test-teams', async (req, res) => {
  try {
    const r = await db.query('SELECT settings FROM organizations WHERE id = $1', [req.user.org_id]);
    const url = (r.rows[0] && r.rows[0].settings && r.rows[0].settings.teams_webhook_url) || req.body.url;
    if (!url) return res.status(400).json({ error: 'Save a Teams webhook URL first' });
    const title = 'Sentinels Kiosk is connected';
    const facts = [['Status', 'Check-in notifications will appear in this channel'], ['Time', new Date().toLocaleString()]];
    const body = /logic\.azure\.com|powerautomate|workflow/i.test(url)
      ? {
          type: 'message',
          attachments: [{
            contentType: 'application/vnd.microsoft.card.adaptive',
            contentUrl: null,
            content: {
              $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
              type: 'AdaptiveCard',
              version: '1.4',
              body: [
                { type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium', wrap: true, color: 'Accent' },
                { type: 'FactSet', facts: facts.map(([t, v]) => ({ title: t, value: String(v) })) },
              ],
            },
          }],
        }
      : {
          '@type': 'MessageCard',
          '@context': 'http://schema.org/extensions',
          themeColor: '0D7377',
          summary: title,
          sections: [{ activityTitle: title, facts: facts.map(([name, value]) => ({ name, value: String(value) })), markdown: true }],
        };
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return res.status(502).json({ error: `Teams rejected the message (HTTP ${resp.status}) — check the webhook URL` });
    res.json({ success: true });
  } catch (e) {
    console.error('Teams test failed:', e.message);
    res.status(502).json({ error: 'Could not reach Teams — check the webhook URL' });
  }
});

// POST /api/settings/test-webhook — POST a sample event to the generic webhook URL
router.post('/test-webhook', async (req, res) => {
  try {
    const r = await db.query('SELECT settings FROM organizations WHERE id = $1', [req.user.org_id]);
    const url = (r.rows[0] && r.rows[0].settings && r.rows[0].settings.generic_webhook_url) || req.body.url;
    if (!url) return res.status(400).json({ error: 'Save a webhook URL first' });
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'test',
        timestamp: new Date().toISOString(),
        data: { message: 'Sentinels Kiosk webhook is connected', first_name: 'Test', last_name: 'Visitor' },
      }),
    });
    if (!resp.ok) return res.status(502).json({ error: `Endpoint rejected the call (HTTP ${resp.status})` });
    res.json({ success: true });
  } catch (e) {
    console.error('Webhook test failed:', e.message);
    res.status(502).json({ error: 'Could not reach the webhook URL' });
  }
});

module.exports = router;
