-- Add subscription fields to organizations
ALTER TABLE organizations 
ADD COLUMN IF NOT EXISTS plan VARCHAR(20) DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'cancelled')),
ADD COLUMN IF NOT EXISTS billing_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS max_users INTEGER DEFAULT 5,
ADD COLUMN IF NOT EXISTS max_visits_per_month INTEGER DEFAULT 100,
ADD COLUMN IF NOT EXISTS current_month_visits INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS billing_cycle_start DATE;

-- Update existing organizations
UPDATE organizations SET plan = 'pro', status = 'active' WHERE name = 'Sentinels';
UPDATE organizations SET plan = 'free', status = 'active' WHERE name = 'Demo Organization';
