const crypto = require('crypto');
const db = require('../config/database');

// API-key authentication for custom integrations (Settings → Integrations).
// Send header:  x-api-key: sk_live_...
// Keys are stored as SHA-256 hashes; the plaintext is shown once at creation.

function hashKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

function generateKey() {
  return 'sk_live_' + crypto.randomBytes(24).toString('hex');
}

async function apiKeyAuth(req, res, next) {
  try {
    const key = req.headers['x-api-key'];
    if (!key) return res.status(401).json({ error: 'Missing x-api-key header' });
    let row;
    try {
      const r = await db.query(
        'UPDATE api_keys SET last_used_at = NOW() WHERE key_hash = $1 AND is_active = true RETURNING org_id',
        [hashKey(key)]
      );
      row = r.rows[0];
    } catch (e) {
      if (e.code === '42P01' || e.code === '42703') {
        return res.status(503).json({ error: 'API keys are not available yet — run the latest migration', code: 'MIGRATION_PENDING' });
      }
      throw e;
    }
    if (!row) return res.status(401).json({ error: 'Invalid or revoked API key' });
    req.user = { org_id: row.org_id, role: 'admin', api_key: true };
    next();
  } catch (err) {
    console.error('API key auth error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

// Accepts either a logged-in dashboard user (JWT) or an API key — used on the
// read endpoints we expose for integrations.
function flexAuth(req, res, next) {
  if (req.headers['x-api-key']) return apiKeyAuth(req, res, next);
  const { authenticate } = require('./auth');
  return authenticate(req, res, next);
}

module.exports = { apiKeyAuth, flexAuth, generateKey, hashKey };
