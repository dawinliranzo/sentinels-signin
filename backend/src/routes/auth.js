const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../utils/db');
const { authenticate, getUserAccess, loadOrg, JWT_SECRET } = require('../middleware/auth');
const { getOrgFeatures, getOrgLimits } = require('../utils/plans');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');

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

    // Temporary password -> must set a new one before anything else
    if (user.must_change_password) {
      const changeToken = jwt.sign({ userId: user.id, orgId: user.org_id, purpose: 'password-change' }, JWT_SECRET, { expiresIn: '15m' });
      return res.json({ must_change_password: true, change_token: changeToken });
    }

    // MFA enabled -> require the authenticator code before issuing a session
    if (user.mfa_enabled && user.mfa_secret) {
      const mfaToken = jwt.sign({ userId: user.id, orgId: user.org_id, purpose: 'mfa' }, JWT_SECRET, { expiresIn: '5m' });
      return res.json({ mfa_required: true, mfa_token: mfaToken });
    }

    const token = jwt.sign({ userId: user.id, orgId: user.org_id }, JWT_SECRET, { expiresIn: '24h' });

    // Org enforces MFA but this user hasn't set it up yet -> flag it
    const orgSettings = orgResult.rows[0]?.settings || {};
    const mfaSetupRequired = !!(orgSettings.mfa_required || user.mfa_required) && !user.mfa_enabled;

    const access = await getUserAccess(user);

    res.json({
      token,
      user: {
        id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name,
        role: user.role, role_id: user.role_id || null,
        permissions: access.permissions, role_label: access.role_label,
      },
      organization: orgResult.rows[0],
      mfa_setup_required: mfaSetupRequired
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/set-password — first-login / post-reset: exchange the
// password-change ticket + new password for a real session
router.post('/set-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Session expired — please sign in again' });
    }
    if (decoded.purpose !== 'password-change') {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const result = await db.query('SELECT * FROM users WHERE id = $1 AND is_active = true', [decoded.userId]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }
    const user = result.rows[0];

    // Don't allow re-using the temporary password
    if (await bcrypt.compare(String(password), user.password_hash)) {
      return res.status(400).json({ error: 'New password must be different from the temporary one' });
    }

    const hashed = await bcrypt.hash(String(password), 10);
    await db.query('UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2', [hashed, user.id]);

    // Password changed — if the org enforces MFA and the user hasn't set it up, flag it
    const orgResult = await db.query('SELECT * FROM organizations WHERE id = $1', [user.org_id]);
    const orgSettings = orgResult.rows[0]?.settings || {};
    const sessionToken = jwt.sign({ userId: user.id, orgId: user.org_id }, JWT_SECRET, { expiresIn: '24h' });

    res.json({
      token: sessionToken,
      user: { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, role: user.role },
      organization: orgResult.rows[0],
      mfa_setup_required: !!(orgSettings.mfa_required || user.mfa_required) && !user.mfa_enabled
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to set password' });
  }
});

// GET /api/auth/me — current user profile (includes offline-alert preference)
router.get('/me', authenticate, async (req, res) => {
  try {
    let result;
    try {
      result = await db.query(
        'SELECT id, email, first_name, last_name, role, role_id, is_active, notify_offline, mfa_enabled, org_id FROM users WHERE id = $1',
        [req.user.id]
      );
    } catch (e) {
      if (e.code !== '42703') throw e; // role_id not migrated yet
      result = await db.query(
        'SELECT id, email, first_name, last_name, role, is_active, notify_offline, mfa_enabled, org_id FROM users WHERE id = $1',
        [req.user.id]
      );
    }
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const access = await getUserAccess(result.rows[0]);
    // Org names for the switcher banner: current (possibly switched) org + home org
    const homeOrgId = req.user.home_org_id || req.user.org_id;
    const orgNames = await db.query(
      'SELECT id, name FROM organizations WHERE id = ANY($1::uuid[])',
      [[req.user.org_id, homeOrgId]]
    );
    const nameOf = (id) => orgNames.rows.find(o => o.id === id)?.name || null;
    // Plan/feature/trial info for the frontend (upgrade banner, nav gating)
    const org = await loadOrg(req);
    res.json({
      ...result.rows[0],
      org_id: req.user.org_id, // reflects the switched org when switching
      org_name: nameOf(req.user.org_id),
      home_org_id: homeOrgId, // the org the user actually belongs to
      home_org_name: nameOf(homeOrgId),
      permissions: access.permissions,
      role_label: access.role_label,
      switched: !!req.user.switched,
      org_plan: org?.plan || 'free',
      org_status: org?.status || 'active',
      trial_ends_at: org?.trial_ends_at || null,
      plan_renews_at: org?.plan_renews_at || null,
      features: org ? getOrgFeatures(org) : [],
      limits: org ? getOrgLimits(org) : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// GET /api/auth/support-orgs — orgs the current user may switch into.
// Super admins can switch into ANY organization (tech support);
// other users only orgs they've been explicitly assigned to.
router.get('/support-orgs', authenticate, async (req, res) => {
  try {
    if (req.user.role === 'super_admin') {
      const r = await db.query(
        "SELECT id, name FROM organizations WHERE status = 'active' AND id != $1 ORDER BY name",
        [req.user.home_org_id || req.user.org_id]
      );
      return res.json(r.rows);
    }
    const r = await db.query(
      `SELECT o.id, o.name FROM support_assignments sa
       JOIN organizations o ON o.id = sa.org_id
       WHERE sa.user_id = $1 AND o.status = 'active' ORDER BY o.name`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (err) {
    if (err.code === '42P01') return res.json([]); // support_assignments not migrated yet
    console.error(err);
    res.status(500).json({ error: 'Failed to load support organizations' });
  }
});

// POST /api/auth/switch-org — mint a session token scoped to another org.
// Allowed for super admins (any org) or users with a support assignment to that org.
router.post('/switch-org', authenticate, async (req, res) => {
  try {
    const { org_id } = req.body;
    if (!org_id) return res.status(400).json({ error: 'org_id required' });

    // Always allowed: returning to your own (home) organization
    const homeOrgId = req.user.home_org_id || req.user.org_id;
    let allowed = req.user.role === 'super_admin' || org_id === homeOrgId;
    if (!allowed) {
      try {
        const r = await db.query(
          'SELECT id FROM support_assignments WHERE user_id = $1 AND org_id = $2',
          [req.user.id, org_id]
        );
        allowed = r.rows.length > 0;
      } catch (e) {
        if (e.code !== '42P01') throw e;
      }
    }
    if (!allowed) {
      return res.status(403).json({ error: 'You do not have tech-support access to that organization' });
    }

    const orgResult = await db.query("SELECT id, name, status FROM organizations WHERE id = $1", [org_id]);
    if (orgResult.rows.length === 0 || orgResult.rows[0].status !== 'active') {
      return res.status(404).json({ error: 'Organization not found or not active' });
    }

    const token = jwt.sign({ userId: req.user.id, orgId: org_id }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, org_name: orgResult.rows[0].name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to switch organization' });
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
    console.error('MFA setup error:', err);
    // 42P01 missing table, 42703 missing column, 42804 type mismatch, 22001 value too long
    if (['42P01', '42703', '42804', '22001'].includes(err.code)) {
      return res.status(500).json({ error: `MFA columns need a fix — run migration-mfa-fix.txt in Render PSQL (code ${err.code})` });
    }
    // Surface the real cause so the next failure tells us exactly what it is
    res.status(500).json({ error: `Failed to start MFA setup (${err.code || err.message || 'unknown'})` });
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

// ---- Demo request: auto-provision a 3-day trial and email the credentials ----
// Public endpoint called from the marketing site's "Request a Demo" form.
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { sendEmail } = require('../utils/notifications');

const demoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Too many requests. Please try again later.' }
});

const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
const makeTempPassword = () =>
  Array.from(crypto.randomBytes(8)).map((b) => TEMP_ALPHABET[b % TEMP_ALPHABET.length]).join('');
const escHtml = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

router.post('/demo-request', demoLimiter, async (req, res) => {
  try {
    const { first_name, last_name, email, company, team_size, plan_interest } = req.body || {};
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!first_name?.trim() || !last_name?.trim() || !company?.trim()) {
      return res.status(400).json({ error: 'First name, last name and company are required' });
    }
    if (!cleanEmail || !cleanEmail.includes('@')) {
      return res.status(400).json({ error: 'A valid email is required' });
    }

    const dup = await db.query('SELECT id FROM users WHERE LOWER(email) = $1', [cleanEmail]);
    if (dup.rows.length > 0) {
      return res.status(400).json({ error: 'That email already has an account — sign in instead, or contact us to reset it.' });
    }

    // 3-day demo organization
    const baseSlug = company.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'demo';
    const slug = `${baseSlug}-${crypto.randomBytes(2).toString('hex')}`;
    const trialEnds = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const orgResult = await db.query(
      "INSERT INTO organizations (name, slug, plan, status, trial_ends_at) VALUES ($1, $2, 'free', 'active', $3) RETURNING id, name",
      [company.trim(), slug, trialEnds]
    );
    const org = orgResult.rows[0];

    const tempPassword = makeTempPassword();
    const hashed = await bcrypt.hash(tempPassword, 10);
    try {
      await db.query(
        `INSERT INTO users (org_id, email, password_hash, first_name, last_name, role, must_change_password)
         VALUES ($1, $2, $3, $4, $5, 'admin', true)`,
        [org.id, cleanEmail, hashed, first_name.trim(), last_name.trim()]
      );
    } catch (e) {
      if (e.code !== '42703') throw e;
      await db.query(
        `INSERT INTO users (org_id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, $4, $5, 'admin')`,
        [org.id, cleanEmail, hashed, first_name.trim(), last_name.trim()]
      );
    }

    const loginUrl = (process.env.FRONTEND_URL || 'https://app.sentinelskiosk.com') + '/login';
    // Credentials to the requester
    sendEmail({
      to: cleanEmail,
      subject: 'Your Sentinels Sign-In demo is ready (3-day access)',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
          <div style="background:#0D7377;color:#fff;padding:20px 28px;border-radius:14px 14px 0 0">
            <h2 style="margin:0;font-size:19px">Your demo is ready 🛡️</h2>
          </div>
          <div style="border:1px solid #E2E8F0;border-top:none;padding:26px 28px;border-radius:0 0 14px 14px;font-size:14px;color:#1E293B">
            <p>Hi ${escHtml(first_name)},</p>
            <p>Your 3-day demo of <strong>Sentinels Sign-In</strong> for <strong>${escHtml(company)}</strong> is active right now. Sign in with:</p>
            <div style="background:#F1F5F9;border-radius:12px;padding:18px;margin:20px 0">
              <div style="font-size:13px;color:#64748B">Email</div>
              <div style="font-weight:700;margin-bottom:12px">${escHtml(cleanEmail)}</div>
              <div style="font-size:13px;color:#64748B">Temporary password</div>
              <div style="font-size:24px;font-weight:800;letter-spacing:3px;font-family:monospace">${tempPassword}</div>
            </div>
            <p style="text-align:center">
              <a href="${loginUrl}" style="display:inline-block;background:#0D7377;color:#fff;text-decoration:none;padding:13px 32px;border-radius:10px;font-weight:700">Sign In to Your Demo</a>
            </p>
            <p style="color:#64748B;font-size:12.5px;margin-top:22px">Your demo ends on <strong>${trialEnds.toUTCString()}</strong>. Want to keep going? Reply to this email and we'll set up your plan.</p>
          </div>
        </div>`
    }).catch(e => console.error('Demo credentials email failed:', e.message));

    // Heads-up to the Sentinels team
    const notifyTo = process.env.ACCESS_REQUEST_EMAIL || 'info@sentinelsit.com';
    sendEmail({
      to: notifyTo,
      subject: `New demo started: ${escHtml(company)}`,
      html: `<div style="font-family:Arial;font-size:14px">
        <p><b>${escHtml(first_name)} ${escHtml(last_name)}</b> (${escHtml(cleanEmail)}) just started a 3-day demo for <b>${escHtml(company)}</b>.</p>
        <p>Team size: ${escHtml(team_size || '—')} · Interested plan: ${escHtml(plan_interest || '—')}</p>
        <p>Trial ends: ${trialEnds.toUTCString()}</p>
      </div>`
    }).catch(e => console.error('Demo notify email failed:', e.message));

    res.json({ success: true, trial_ends_at: trialEnds });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create your demo. Please try again or email us directly.' });
  }
});

module.exports = router;
