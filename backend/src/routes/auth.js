const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../utils/db');
const { JWT_SECRET } = require('../middleware/auth');

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

    const token = jwt.sign({ userId: user.id, orgId: user.org_id }, JWT_SECRET, { expiresIn: '24h' });

    res.json({
      token,
      user: { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, role: user.role },
      organization: orgResult.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

module.exports = router;
