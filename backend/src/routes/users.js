const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../utils/db');
const { authenticate, requireRole } = require('../middleware/auth');

// All routes: logged-in org admin (or super admin), scoped to their own org
router.use(authenticate, requireRole('admin', 'super_admin'));

// GET /api/users — list users in my organization
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, email, first_name, last_name, role, is_active, mfa_enabled FROM users WHERE org_id = $1 ORDER BY first_name, last_name',
      [req.user.org_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// POST /api/users — create a user in my organization
router.post('/', async (req, res) => {
  try {
    const { email, password, first_name, last_name, role } = req.body;

    if (!email || !password || !first_name || !last_name) {
      return res.status(400).json({ error: 'Email, password, first name and last name are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    // Never allow creating super admins from here
    const safeRole = role === 'admin' ? 'admin' : 'receptionist';

    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'A user with this email already exists' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const result = await db.query(
      `INSERT INTO users (org_id, email, password_hash, first_name, last_name, role, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING id, email, first_name, last_name, role, is_active`,
      [req.user.org_id, email.toLowerCase(), hashed, first_name, last_name, safeRole]
    );

    res.status(201).json(result.rows[0]);
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

    const tempPassword = 'Ksk-' + crypto.randomBytes(4).toString('hex');
    const hashed = await bcrypt.hash(tempPassword, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashed, req.params.id]);

    res.json({ success: true, temp_password: tempPassword, user_email: userResult.rows[0].email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reset password' });
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
