const jwt = require('jsonwebtoken');
const db = require('../utils/db');

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';

// Permission keys used across the app (nav sections + backend route guards)
const ALL_PERMISSIONS = ['visits', 'prereg', 'hosts', 'devices', 'team', 'reports', 'compliance', 'settings', 'deliveries'];
const RECEPTIONIST_PERMISSIONS = ['visits', 'prereg'];

// Resolve a user's effective permissions + display label.
// A custom role (users.role_id -> org_roles) takes precedence over the base role.
async function getUserAccess(user) {
  if (user.role_id) {
    try {
      const r = await db.query('SELECT name, permissions FROM org_roles WHERE id = $1', [user.role_id]);
      if (r.rows[0]) {
        return { role_label: r.rows[0].name, permissions: r.rows[0].permissions || [] };
      }
    } catch (e) {
      if (e.code !== '42P01') throw e; // org_roles table may not exist yet pre-migration
    }
  }
  if (user.role === 'receptionist') {
    return { role_label: 'Receptionist', permissions: RECEPTIONIST_PERMISSIONS };
  }
  return {
    role_label: user.role === 'super_admin' ? 'Super Admin' : 'Admin',
    permissions: user.role === 'super_admin' ? [...ALL_PERMISSIONS, 'super'] : ALL_PERMISSIONS,
  };
}

const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    // Purpose-scoped tokens (e.g. password-change tickets) are not sessions
    if (decoded.purpose) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    let result;
    try {
      result = await db.query(
        'SELECT id, email, first_name, last_name, role, role_id, org_id, is_active, mfa_enabled, mfa_required, preferences FROM users WHERE id = $1',
        [decoded.userId]
      );
    } catch (e) {
      if (e.code !== '42703') throw e; // role_id column not migrated yet — fall back
      result = await db.query(
        'SELECT id, email, first_name, last_name, role, org_id, is_active, mfa_enabled, mfa_required, preferences FROM users WHERE id = $1',
        [decoded.userId]
      );
    }

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (!result.rows[0].is_active) {
      return res.status(401).json({ error: 'Account is deactivated' });
    }

    req.user = result.rows[0];

    // Org switching: the switch-org endpoint signs tokens with a different orgId.
    // JWTs are server-signed, so a different orgId can only come from that flow.
    if (decoded.orgId && decoded.orgId !== req.user.org_id) {
      req.user.home_org_id = req.user.org_id;
      req.user.org_id = decoded.orgId;
      req.user.switched = true;
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

// Permission guard that understands custom roles.
// Admins/super admins pass everything; custom role checks its permission list;
// receptionists pass only visits/prereg.
const requirePermission = (perm) => {
  return async (req, res, next) => {
    try {
      // Switched sessions were explicitly granted support access by a super admin —
      // they get full access inside the customer org regardless of their home role.
      if (req.user.switched) return next();
      const { permissions } = await getUserAccess(req.user);
      if (req.user.role === 'admin' || req.user.role === 'super_admin' || permissions.includes(perm)) {
        return next();
      }
      return res.status(403).json({ error: 'Insufficient permissions' });
    } catch (err) {
      console.error('Permission check failed:', err);
      return res.status(500).json({ error: 'Permission check failed' });
    }
  };
};

module.exports = { authenticate, requireRole, requirePermission, getUserAccess, JWT_SECRET, ALL_PERMISSIONS, RECEPTIONIST_PERMISSIONS };
