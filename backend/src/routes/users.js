const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../utils/db');
const { authenticate, requireRole, requirePermission, loadOrg } = require('../middleware/auth');
const { checkUserCap } = require('../utils/limits');
const { sendEmail } = require('../utils/notifications');

// All routes: logged-in org admin (or super admin), scoped to their own org
router.use(authenticate, requirePermission('team'));

// 8-char temporary password from an unambiguous alphabet (easy to read & type)
const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
const makeTempPassword = () =>
  Array.from(crypto.randomBytes(8)).map((b) => TEMP_ALPHABET[b % TEMP_ALPHABET.length]).join('');

const loginUrl = () => (process.env.FRONTEND_URL || 'https://app.sentinelskiosk.com') + '/login';

const sendInviteEmail = async ({ to, firstName, tempPassword, orgName, isReset }) => {
  const esc = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return sendEmail({
    to,
    subject: isReset ? 'Your Sentinels Kiosk password was reset' : `You're invited to ${orgName || 'your team'} on Sentinels Kiosk`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
        <div style="background:#0D7377;color:#fff;padding:20px 28px;border-radius:14px 14px 0 0">
          <h2 style="margin:0;font-size:19px">${isReset ? 'Password Reset' : 'Welcome to Sentinels Kiosk'} 🛡️</h2>
        </div>
        <div style="border:1px solid #E2E8F0;border-top:none;padding:26px 28px;border-radius:0 0 14px 14px;font-size:14px;color:#1E293B">
          <p>Hi ${esc(firstName) || 'there'},</p>
          <p>${isReset
            ? 'An administrator reset your password. Sign in with the temporary password below — you\'ll be asked to set a new one right away.'
            : `You've been invited to join <strong>${esc(orgName) || 'your organization'}</strong> on Sentinels Kiosk, the visitor management kiosk. Sign in with the temporary password below — you'll be asked to set your own password right away.`}</p>
          <div style="background:#F1F5F9;border-radius:12px;padding:18px;text-align:center;margin:22px 0">
            <div style="font-size:12px;color:#64748B;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">Temporary password</div>
            <div style="font-size:28px;font-weight:800;letter-spacing:4px;font-family:monospace;color:#0F172A">${tempPassword}</div>
          </div>
          <p style="text-align:center">
            <a href="${loginUrl()}" style="display:inline-block;background:#0D7377;color:#fff;text-decoration:none;padding:13px 32px;border-radius:10px;font-weight:700">Sign In</a>
          </p>
          <p style="color:#64748B;font-size:12.5px;margin-top:24px">Sign in at <a href="${loginUrl()}">${loginUrl()}</a> with this email address and the temporary password above.</p>
        </div>
      </div>`
  });
};

// GET /api/users — list users in my organization
router.get('/', async (req, res) => {
  try {
    try {
      const result = await db.query(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.role_id, u.is_active,
                u.mfa_enabled, u.mfa_required, o.name as custom_role_name
         FROM users u LEFT JOIN org_roles o ON o.id = u.role_id
         WHERE u.org_id = $1 ORDER BY u.first_name, u.last_name`,
        [req.user.org_id]
      );
      return res.json(result.rows);
    } catch (e) {
      if (e.code !== '42703' && e.code !== '42P01') throw e; // roles migration not run yet
      const result = await db.query(
        'SELECT id, email, first_name, last_name, role, is_active, mfa_enabled, mfa_required FROM users WHERE org_id = $1 ORDER BY first_name, last_name',
        [req.user.org_id]
      );
      return res.json(result.rows.map(u => ({ ...u, role_id: null, custom_role_name: null })));
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// POST /api/users — invite a user: server generates an 8-char temp password,
// emails it to them, and forces a password change on first sign-in
router.post('/', async (req, res) => {
  try {
    const { email, first_name, last_name, role, custom_role_id } = req.body;

    if (!email || !first_name || !last_name) {
      return res.status(400).json({ error: 'Email, first name and last name are required' });
    }
    const safeRole = role === 'admin' ? 'admin' : 'receptionist';

    // Optional custom role (org_roles) — verify it belongs to this org
    let roleId = null;
    if (custom_role_id) {
      try {
        const rr = await db.query('SELECT id FROM org_roles WHERE id = $1 AND org_id = $2', [custom_role_id, req.user.org_id]);
        if (rr.rows.length === 0) return res.status(400).json({ error: 'Custom role not found in your organization' });
        roleId = custom_role_id;
      } catch (e) {
        if (e.code === '42P01') return res.status(400).json({ error: 'Custom roles need the roles migration to be run first' });
        throw e;
      }
    }

    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'A user with this email already exists' });
    }

    // Plan limit: active users
    const cap = await checkUserCap(await loadOrg(req));
    if (!cap.allowed) {
      return res.status(403).json({
        error: `Your plan allows up to ${cap.cap} active users and you have ${cap.used}. Deactivate someone first, or contact Sentinels to upgrade.`,
        code: 'USER_CAP'
      });
    }

    const tempPassword = makeTempPassword();
    const hashed = await bcrypt.hash(tempPassword, 10);
    let result;
    try {
      result = await db.query(
        `INSERT INTO users (org_id, email, password_hash, first_name, last_name, role, role_id, is_active, must_change_password)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, true) RETURNING id, email, first_name, last_name, role, is_active`,
        [req.user.org_id, email.toLowerCase(), hashed, first_name, last_name, safeRole, roleId]
      );
    } catch (e) {
      if (e.code !== '42703') throw e; // role_id not migrated yet
      result = await db.query(
        `INSERT INTO users (org_id, email, password_hash, first_name, last_name, role, is_active, must_change_password)
         VALUES ($1, $2, $3, $4, $5, $6, true, true) RETURNING id, email, first_name, last_name, role, is_active`,
        [req.user.org_id, email.toLowerCase(), hashed, first_name, last_name, safeRole]
      );
    }

    const orgRes = await db.query('SELECT name FROM organizations WHERE id = $1', [req.user.org_id]);
    const emailResult = await sendInviteEmail({
      to: email.toLowerCase(), firstName: first_name, tempPassword,
      orgName: orgRes.rows[0]?.name, isReset: false
    });

    res.status(201).json({ ...result.rows[0], temp_password: tempPassword, invite_sent: !!emailResult?.success && !emailResult?.simulated, email_error: emailResult?.error || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// POST /api/users/:id/reset-password — temp password for a user in my org
router.post('/:id/reset-password', async (req, res) => {
  try {
    const userResult = await db.query(
      'SELECT id, email FROM users WHERE id = $1 AND org_id = $2',
      [req.params.id, req.user.org_id]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const tempPassword = makeTempPassword();
    const hashed = await bcrypt.hash(tempPassword, 10);
    await db.query('UPDATE users SET password_hash = $1, must_change_password = true WHERE id = $2', [hashed, req.params.id]);

    const userRow = await db.query('SELECT first_name FROM users WHERE id = $1', [req.params.id]);
    const emailResult = await sendInviteEmail({
      to: userResult.rows[0].email, firstName: userRow.rows[0]?.first_name,
      tempPassword, orgName: null, isReset: true
    });

    res.json({ success: true, temp_password: tempPassword, user_email: userResult.rows[0].email, invite_sent: !!emailResult?.success && !emailResult?.simulated, email_error: emailResult?.error || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Require / unrequire MFA for one team member — they will be asked to set it up at next login
router.patch('/:id/mfa-require', async (req, res) => {
  try {
    const required = !!req.body.required;
    const userResult = await db.query(
      'SELECT id, email, role, mfa_enabled FROM users WHERE id = $1 AND org_id = $2',
      [req.params.id, req.user.org_id]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const target = userResult.rows[0];
    if (target.role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only a super admin can change a super admin\'s MFA requirement' });
    }
    if (required && target.mfa_enabled) {
      return res.json({ success: true, note: 'already_enabled', user_email: target.email });
    }
    await db.query('UPDATE users SET mfa_required = $1 WHERE id = $2', [required, req.params.id]);
    res.json({ success: true, mfa_required: required, user_email: target.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update MFA requirement' });
  }
});

// Reset a team member's MFA (e.g. they lost their authenticator).
// Clears their secret; on next login they sign in with password only and can re-enable MFA from Settings.
router.post('/:id/reset-mfa', async (req, res) => {
  try {
    const userResult = await db.query(
      'SELECT id, email, role, mfa_enabled FROM users WHERE id = $1 AND org_id = $2',
      [req.params.id, req.user.org_id]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const target = userResult.rows[0];

    // Only a super admin can reset another super admin's MFA
    if (target.role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only a super admin can reset a super admin\'s MFA' });
    }

    if (!target.mfa_enabled) {
      return res.json({ success: true, already_disabled: true, user_email: target.email });
    }

    await db.query('UPDATE users SET mfa_enabled = false, mfa_secret = NULL WHERE id = $1', [req.params.id]);
    res.json({ success: true, already_disabled: false, user_email: target.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reset MFA' });
  }
});

// PATCH /api/users/:id/role — change a member's role.
// Body: { role: 'receptionist'|'admin'|'super_admin' } for built-ins
//    or { custom_role_id: '<org_roles id>' } for a custom role (clears with { role: ... }).
// Only super admins can grant or revoke super_admin.
router.patch('/:id/role', async (req, res) => {
  try {
    const { role, custom_role_id } = req.body;
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot change your own role' });
    }

    const userResult = await db.query(
      'SELECT id, email, role FROM users WHERE id = $1 AND org_id = $2',
      [req.params.id, req.user.org_id]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const target = userResult.rows[0];

    if (target.role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only a super admin can change a super admin role' });
    }

    if (custom_role_id) {
      // Custom role must belong to this org
      let roleRow;
      try {
        const r = await db.query('SELECT id, name FROM org_roles WHERE id = $1 AND org_id = $2', [custom_role_id, req.user.org_id]);
        roleRow = r.rows[0];
      } catch (e) {
        if (e.code === '42P01') return res.status(500).json({ error: 'Custom roles table missing — run the latest migration in Render PSQL' });
        throw e;
      }
      if (!roleRow) return res.status(404).json({ error: 'Custom role not found' });
      await db.query('UPDATE users SET role_id = $1 WHERE id = $2', [custom_role_id, req.params.id]);
      return res.json({ id: req.params.id, email: target.email, role: target.role, role_id: custom_role_id, custom_role_name: roleRow.name });
    }

    if (!['receptionist', 'admin', 'super_admin'].includes(role)) {
      return res.status(400).json({ error: 'Role must be receptionist, admin, or super_admin' });
    }
    if (role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only a super admin can grant or change a super admin role' });
    }

    // Built-in role assignment clears any custom role
    try {
      await db.query('UPDATE users SET role = $1, role_id = NULL WHERE id = $2', [role, req.params.id]);
    } catch (e) {
      if (e.code !== '42703') throw e; // role_id column not migrated yet
      await db.query('UPDATE users SET role = $1 WHERE id = $2', [role, req.params.id]);
    }
    res.json({ id: req.params.id, email: target.email, role, role_id: null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// PATCH /api/users/:id/status — activate/deactivate a user in my org (not myself)
router.patch('/:id/status', async (req, res) => {
  try {
    const { is_active } = req.body;
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ error: 'is_active (boolean) is required' });
    }
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }

    const result = await db.query(
      'UPDATE users SET is_active = $1 WHERE id = $2 AND org_id = $3 RETURNING id, email, is_active',
      [is_active, req.params.id, req.user.org_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

module.exports = router;
