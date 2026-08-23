// Security alerts — the silent half of the anti-tailgating pack.
//
// When the kiosk blocks a suspicious re-entry (anti-passback) or a UniFi
// camera counts more people at a door than check-ins were recorded
// (tailgating), the visitor sees only a neutral "please see the front desk"
// screen — the details land HERE, for staff: a row in security_alerts
// (Dashboard → Security Alerts) plus an email to every active admin.
//
// Everything degrades open: a missing table (migration not run yet) or an
// email failure logs loudly and never breaks a check-in.
const db = require('./db');
const { sendEmail } = require('./notifications');

// Insert an alert. Returns the new row id, or null when the table is missing.
async function createSecurityAlert(orgId, type, message, metadata = {}) {
  try {
    const r = await db.query(
      'INSERT INTO security_alerts (org_id, type, message, metadata) VALUES ($1, $2, $3, $4) RETURNING id',
      [orgId, type, message, JSON.stringify(metadata)]
    );
    return r.rows[0]?.id || null;
  } catch (e) {
    if (e.code === '42P01') {
      console.error('security_alerts table missing — run migration-security-groups.txt in Render PSQL');
      return null;
    }
    console.error('Security alert insert failed:', e.message);
    return null;
  }
}

// Cooldown guard: is there already an alert of this type + metadata key
// (e.g. camera name / person identity) younger than `minutes`? Prevents a
// busy door from emailing admins every 30 seconds.
async function recentAlertExists(orgId, type, metaKey, metaValue, minutes) {
  try {
    const r = await db.query(
      `SELECT 1 FROM security_alerts
       WHERE org_id = $1 AND type = $2 AND metadata ->> $3 = $4
         AND created_at > NOW() - ($5 || ' minutes')::interval
       LIMIT 1`,
      [orgId, type, metaKey, String(metaValue), String(minutes)]
    );
    return r.rows.length > 0;
  } catch (e) {
    if (e.code === '42P01') return false;
    console.error('Alert cooldown check failed:', e.message);
    return false;
  }
}

// Email every active admin — security alerts are not opt-out per admin:
// if you can administer the org, you get its entry alerts.
async function notifySecurityAdmins(orgId, subject, html) {
  try {
    const admins = await db.query(
      `SELECT email, first_name FROM users
       WHERE org_id = $1 AND role IN ('admin', 'super_admin') AND is_active = true`,
      [orgId]
    );
    for (const admin of admins.rows) {
      sendEmail({ to: admin.email, subject, html: html.replace(/\{\{name\}\}/g, admin.first_name || 'there') })
        .catch(() => {});
    }
  } catch (e) {
    console.error('Security admin notify failed:', e.message);
  }
}

// Convenience: raise the alert + email admins in one call (fire-and-forget
// safe — never throws).
async function raiseSecurityAlert(orgId, type, message, metadata = {}) {
  const id = await createSecurityAlert(orgId, type, message, metadata);
  notifySecurityAdmins(
    orgId,
    `Security alert — ${type === 'tailgating' ? 'possible tailgating' : 'possible badge pass-back'}`,
    `<p>Hi {{name}},</p>
     <p><strong>${message}</strong></p>
     <p>The visitor was shown a neutral front-desk message — no security details were disclosed at the kiosk.</p>
     <p>Open your <strong>Dashboard → Security Alerts</strong> to review and acknowledge.</p>
     <p>— Sentinels Kiosk</p>`
  );
  return id;
}

module.exports = { createSecurityAlert, recentAlertExists, notifySecurityAdmins, raiseSecurityAlert };
