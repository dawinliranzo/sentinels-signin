-- Seed script for Sentinels Sign-In App
-- Run this after creating the database to set up default data

-- Insert default organization
INSERT INTO organizations (id, name, slug, primary_color, accent_color)
VALUES ('00000000-0000-0000-0000-000000000001', 'Demo Organization', 'demo-org', '#0D7377', '#FF6B35')
ON CONFLICT (id) DO NOTHING;

-- Insert default visitor types for the demo org
INSERT INTO visitor_types (id, org_id, name, description, badge_color, requires_nda)
VALUES 
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Guest', 'General visitor or guest', '#0D7377', false),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Contractor', 'External contractor or vendor', '#FF6B35', true),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Delivery', 'Package or delivery personnel', '#2ECC71', false),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'Interview Candidate', 'Job interview candidate', '#9B59B6', false)
ON CONFLICT (id) DO NOTHING;

-- Insert demo hosts
INSERT INTO hosts (id, org_id, first_name, last_name, email, department, job_title, notify_email)
VALUES 
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Alice', 'Johnson', 'alice@demo.com', 'HR', 'HR Manager', true),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Bob', 'Smith', 'bob@demo.com', 'Engineering', 'Tech Lead', true),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Carol', 'Williams', 'carol@demo.com', 'Sales', 'Sales Director', true)
ON CONFLICT (id) DO NOTHING;
