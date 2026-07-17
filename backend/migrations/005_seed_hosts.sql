-- Seed hosts for ALL existing organizations that don't have hosts
-- Uses the first admin user as the default host
DO $$
DECLARE
    org_record RECORD;
    first_user RECORD;
BEGIN
    FOR org_record IN SELECT id FROM organizations
    LOOP
        -- Check if this org already has hosts
        IF NOT EXISTS (SELECT 1 FROM hosts WHERE org_id = org_record.id) THEN
            -- Find the first admin user for this org
            SELECT * INTO first_user FROM users 
            WHERE org_id = org_record.id AND role = 'admin' 
            ORDER BY created_at LIMIT 1;

            IF FOUND THEN
                INSERT INTO hosts (id, org_id, first_name, last_name, email, department, job_title, notify_email)
                VALUES (
                    uuid_generate_v4(), 
                    org_record.id, 
                    first_user.first_name, 
                    first_user.last_name, 
                    first_user.email, 
                    'Admin', 
                    'Administrator', 
                    true
                );
            END IF;
        END IF;
    END LOOP;
END $$;
