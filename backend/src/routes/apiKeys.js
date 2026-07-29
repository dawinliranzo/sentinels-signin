const express = require('express');
const router = express.Router();
const db = require('../utils/db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { generateKey, hashKey } = require('../middleware/apiKey');

// API key management (Settings → Integrations). Plaintext is shown ONCE.

// POST /api/api-keys — create a key
router.post('/', authenticate, requirePermission('settings'), async (req, res) => {
  try {
    const label = String(req.body.label || 'Integration key').trim().slice(0, 100) || 'Integration key';
    const key = generateKey();
    try {
      const r = await db.query(
        'INSERT INTO api_keys (org_id, label, key_hash, key_prefix) VALUES ($1, $2, $3, $4) RETURNING id, label, key_prefix, created_at',
        [req.user.org_id, label, hashKey(key), key.slice(0, 12)]
      );
      // The only time the full key is ever returned
      res.status(201).json({ ...r.rows[0], key });
    } catch (e) {
      if (e.code === '42P01' || e.code === '42703') {
        return res.status(503).json({ error: 'Run the latest migration to enable API keys', code: 'MIGRATION_PENDING' });
      }
      throw e;
    }
  } catch (err) {
    console.error('Create API key error:', err);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// GET /api/api-keys — list (prefix only, never the secret)
router.get('/', authenticate, requirePermission('settings'), async (req, res) => {
  try {
    try {
      const r = await db.query(
        'SELECT id, label, key_prefix, is_active, last_used_at, created_at FROM api_keys WHERE org_id = $1 ORDER BY created_at DESC',
        [req.user.org_id]
      );
      res.json(r.rows);
    } catch (e) {
      if (e.code === '42P01' || e.code === '42703') return res.json([]);
      throw e;
    }
  } catch (err) {
    console.error('List API keys error:', err);
    res.status(500).json({ error: 'Failed to list API keys' });
  }
});

// DELETE /api/api-keys/:id — revoke
router.delete('/:id', authenticate, requirePermission('settings'), async (req, res) => {
  try {
    const r = await db.query('UPDATE api_keys SET is_active = false WHERE id = $1 AND org_id = $2 RETURNING id', [req.params.id, req.user.org_id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Key not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Revoke API key error:', err);
    res.status(500).json({ error: 'Failed to revoke key' });
  }
});

module.exports = router;
