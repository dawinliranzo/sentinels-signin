const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../utils/db');
const { authenticate, JWT_SECRET } = require('../middleware/auth');

router.post('/register', async (req, res) => {
  try {
    const { org_name, email, password, first_name, last_name } = req.body;

    // Create organization
    const orgSlug = org_name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const orgResult = await db.query(
      'INSERT INTO organizations (name, slug, plan, trial_ends_at) VALUES ($1, $2, $3, $4) RETURNING *',
      [org_name, orgSlug, 'free', new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)]
    );
    const org = orgResult.rows[0];

    // Create admin user
    const hashedPassword = await bcrypt.hash(password, 10);
    const userResult = await db.query(
      'INSERT INTO users (org_id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [org.id, email, hashedPassword, first_name, last_name, 'admin']
    );

    const token = jwt.sign({ userId: userResult.rows[0].id, orgId: org.id }, JWT_SECRET, { expiresIn: '24h' });

    res.status(201).json({
      token,
      user: { id: userResult.rows[0].id, email, first_name, last_name, role: 'admin' },
      organization: org
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    const orgResult = await db.query('SELECT * FROM organizations WHERE id = $1', [user.org_id]);

    // MFA enabled -> require the authenticator code before issuing a session
    if (user.mfa_enabled && user.mfa_secret) {
      const mfaToken = jwt.sign({ userId: user.id, orgId: user.org_id, purpose: 'mfa' }, JWT_SECRET, { expiresIn: '5m' });
      return res.json({ mfa_required: true, mfa_token: mfaToken });
    }

    const token = jwt.sign({ userId: user.id, orgId: user.org_id }, JWT_SECRET, { expiresIn: '24h' });

    // Org enforces MFA but this user hasn't set it up yet -> flag it
    const orgSettings = orgResult.rows[0]?.settings || {};
    const mfaSetupRequired = !!orgSettings.mfa_required && !user.mfa_enabled;

    res.json({
      token,
      user: { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, role: user.role },
      organization: orgResult.rows[0],
      mfa_setup_required: mfaSetupRequired
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me — current user profile (includes offline-alert preference)
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, email, first_name, last_name, role, is_active, notify_offline, mfa_enabled, org_id FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// PATCH /api/auth/me/preferences — self-service preference updates
router.patch('/me/preferences', authenticate, async (req, res) => {
  try {
    const { notify_offline } = req.body;
    if (typeof notify_offline !== 'boolean') {
      return res.status(400).json({ error: 'notify_offline must be true or false' });
    }
    await db.query('UPDATE users SET notify_offline = $1 WHERE id = $2', [notify_offline, req.user.id]);
    res.json({ success: true, notify_offline });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save preference', details: err.message });
  }
});

// ─── MFA (TOTP authenticator) ───

// POST /api/auth/mfa/login — second step of login when MFA is on
router.post('/mfa/login', async (req, res) => {
  try {
    const { mfa_token, code } = req.body;
    let payload;
    try {
      payload = jwt.verify(mfa_token, JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ error: 'MFA session expired — log in again' });
    }
    if (payload.purpose !== 'mfa') {
      return res.status(401).json({ error: 'Invalid MFA session' });
    }

    const result = await db.query('SELECT * FROM users WHERE id = $1', [payload.userId]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }
    const user = result.rows[0];

    const valid = authenticator.verify({ token: String(code || '').replace(/\s/g, ''), secret: user.mfa_secret });
    if (!valid) {
      return res.status(401).json({ error: 'Invalid authentication code' });
    }

    const orgResult = await db.query('SELECT * FROM organizations WHERE id = $1', [user.org_id]);
    const token = jwt.sign({ userId: user.id, orgId: user.org_id }, JWT_SECRET, { expiresIn: '24h' });

    res.json({
      token,
      user: { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, role: user.role },
      organization: orgResult.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'MFA verification failed' });
  }
});

// POST /api/auth/mfa/setup — generate a secret + QR (does not enable yet)
router.post('/mfa/setup', authenticate, async (req, res) => {
  try {
    const secret = authenticator.generateSecret();
    await db.query('UPDATE users SET mfa_secret = $1 WHERE id = $2', [secret, req.user.id]);
    const otpauth = authenticator.keyuri(req.user.email, 'Sentinels Sign-In', secret);
    const qr = await QRCode.toDataURL(otpauth, { width: 240, margin: 1 });
    res.json({ secret, qr });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to start MFA setup' });
  }
});

// POST /api/auth/mfa/enable — verify first code, then enable
router.post('/mfa/enable', authenticate, async (req, res) => {
  try {
    const result = await db.query('SELECT mfa_secret FROM users WHERE id = $1', [req.user.id]);
    const secret = result.rows[0]?.mfa_secret;
    if (!secret) {
      return res.status(400).json({ error: 'Start MFA setup first' });
    }
    const valid = authenticator.verify({ token: String(req.body.code || '').replace(/\s/g, ''), secret });
    if (!valid) {
      return res.status(401).json({ error: 'Invalid code — check your authenticator app and try again' });
    }
    await db.query('UPDATE users SET mfa_enabled = true WHERE id = $1', [req.user.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to enable MFA' });
  }
});

// POST /api/auth/mfa/disable — verify a current code, then disable
router.post('/mfa/disable', authenticate, async (req, res) => {
  try {
    const result = await db.query('SELECT mfa_secret FROM users WHERE id = $1', [req.user.id]);
    const secret = result.rows[0]?.mfa_secret;
    if (!secret) {
      return res.status(400).json({ error: 'MFA is not enabled' });
    }
    const valid = authenticator.verify({ token: String(req.body.code || '').replace(/\s/g, ''), secret });
    if (!valid) {
      return res.status(401).json({ error: 'Invalid code' });
    }
    await db.query('UPDATE users SET mfa_enabled = false, mfa_secret = NULL WHERE id = $1', [req.user.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to disable MFA' });
  }
});

module.exports = router;
