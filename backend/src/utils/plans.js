// Plan definitions: what each tier includes by default.
// An organization's `features` JSONB column overrides individual keys
// (e.g. {"reports": true} grants reports to a Free org as an exception).

// Sellable features — these are the checkboxes in Super Admin → Manage
const FEATURE_DEFS = [
  { key: 'reports',       label: 'Reports & analytics' },
  { key: 'compliance',    label: 'Compliance / NDA records' },
  { key: 'sms',           label: 'SMS notifications (Twilio)' },
  { key: 'bulk_import',   label: 'Bulk host import (CSV)' },
  { key: 'custom_fields', label: 'Custom registration fields' },
  { key: 'backups',       label: 'Daily backups (snapshot + download)' },
];

const PLANS = {
  free: {
    label: 'Free',
    max_users: 5,
    max_visits_per_month: 100,
    max_devices: 1,
    features: [], // no paid features
  },
  pro: {
    label: 'Pro',
    max_users: 25,
    max_visits_per_month: 2000,
    max_devices: 5,
    features: ['reports', 'compliance', 'sms', 'bulk_import', 'custom_fields'],
  },
  enterprise: {
    label: 'Enterprise',
    max_users: 1000,
    max_visits_per_month: 100000,
    max_devices: 50,
    features: ['reports', 'compliance', 'sms', 'bulk_import', 'custom_fields', 'backups'],
  },
};

const planOf = (org) => PLANS[org?.plan] || PLANS.free;

// Resolved feature set for an org = plan defaults + per-org overrides.
// Override values are booleans; anything not overridden follows the plan.
function getOrgFeatures(org) {
  const base = new Set(planOf(org).features);
  const overrides = org?.features || {};
  for (const def of FEATURE_DEFS) {
    if (def.key in overrides) {
      if (overrides[def.key]) base.add(def.key);
      else base.delete(def.key);
    }
  }
  return [...base];
}

const hasFeature = (org, key) => getOrgFeatures(org).includes(key);

// Limits: org-level columns win when set, otherwise the plan default.
function getOrgLimits(org) {
  const p = planOf(org);
  return {
    max_users: org?.max_users ?? p.max_users,
    max_visits_per_month: org?.max_visits_per_month ?? p.max_visits_per_month,
    max_devices: org?.max_devices ?? p.max_devices,
  };
}

module.exports = { PLANS, FEATURE_DEFS, getOrgFeatures, getOrgLimits, hasFeature };
