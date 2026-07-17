-- Seed visitor types for ALL existing organizations that don't have them
DO $$
DECLARE
    org_record RECORD;
BEGIN
    FOR org_record IN SELECT id FROM organizations
    LOOP
        -- Check if this org already has visitor types
        IF NOT EXISTS (SELECT 1 FROM visitor_types WHERE org_id = org_record.id) THEN
            INSERT INTO visitor_types (id, org_id, name, description, badge_color, requires_nda)
            VALUES 
                (uuid_generate_v4(), org_record.id, 'Guest', 'General visitor or guest', '#0D7377', false),
                (uuid_generate_v4(), org_record.id, 'Contractor', 'External contractor or vendor', '#FF6B35', true),
                (uuid_generate_v4(), org_record.id, 'Delivery', 'Package or delivery personnel', '#2ECC71', false),
                (uuid_generate_v4(), org_record.id, 'Interview', 'Job interview candidate', '#9B59B6', false);
        END IF;
    END LOOP;
END $$;
