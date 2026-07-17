-- Sentinels Sign-In App Database Schema
-- Run this against your PostgreSQL database

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Organizations (multi-tenant)
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    logo_url TEXT,
    primary_color VARCHAR(7) DEFAULT '#0D7377',
    accent_color VARCHAR(7) DEFAULT '#FF6B35',
    address TEXT,
    phone VARCHAR(50),
    timezone VARCHAR(50) DEFAULT 'America/New_York',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Users (admins, receptionists, security)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    role VARCHAR(20) DEFAULT 'admin' CHECK (role IN ('super_admin', 'admin', 'receptionist', 'security')),
    phone VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Hosts (employees who receive visitors)
CREATE TABLE hosts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    department VARCHAR(100),
    job_title VARCHAR(100),
    photo_url TEXT,
    notify_email BOOLEAN DEFAULT true,
    notify_sms BOOLEAN DEFAULT false,
    notify_slack BOOLEAN DEFAULT false,
    slack_webhook_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Visitor Types (Guest, Contractor, Delivery, Interview, etc.)
CREATE TABLE visitor_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    badge_color VARCHAR(7) DEFAULT '#0D7377',
    requires_nda BOOLEAN DEFAULT false,
    requires_photo BOOLEAN DEFAULT false,
    requires_id_scan BOOLEAN DEFAULT false,
    custom_fields JSONB DEFAULT '[]',
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Pre-registered Visitors (invited ahead of time)
CREATE TABLE pre_registered_visitors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    company VARCHAR(100),
    host_id UUID REFERENCES hosts(id) ON DELETE SET NULL,
    visitor_type_id UUID REFERENCES visitor_types(id) ON DELETE SET NULL,
    purpose TEXT,
    expected_date DATE,
    expected_time_start TIME,
    expected_time_end TIME,
    qr_code TEXT,
    qr_expires_at TIMESTAMP,
    invitation_sent_at TIMESTAMP,
    invitation_status VARCHAR(20) DEFAULT 'pending' CHECK (invitation_status IN ('pending', 'sent', 'opened', 'used')),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Visits (the actual check-in records)
CREATE TABLE visits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    pre_reg_id UUID REFERENCES pre_registered_visitors(id) ON DELETE SET NULL,
    visitor_type_id UUID REFERENCES visitor_types(id) ON DELETE SET NULL,
    host_id UUID REFERENCES hosts(id) ON DELETE SET NULL,

    -- Visitor info (denormalized for audit trail)
    visitor_first_name VARCHAR(100) NOT NULL,
    visitor_last_name VARCHAR(100) NOT NULL,
    visitor_email VARCHAR(255),
    visitor_phone VARCHAR(50),
    visitor_company VARCHAR(100),
    visitor_photo_url TEXT,
    visitor_id_scan_url TEXT,

    -- Visit details
    purpose TEXT,
    badge_number VARCHAR(20),
    vehicle_plate VARCHAR(20),

    -- Sign method
    sign_in_method VARCHAR(20) DEFAULT 'kiosk' CHECK (sign_in_method IN ('kiosk', 'qr_code', 'web', 'manual')),

    -- Timestamps
    checked_in_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    checked_out_at TIMESTAMP,
    expected_check_out_at TIMESTAMP,

    -- Status
    status VARCHAR(20) DEFAULT 'checked_in' CHECK (status IN ('checked_in', 'checked_out', 'overstayed', 'no_show')),

    -- Custom data collected
    custom_data JSONB DEFAULT '{}',

    -- Signed documents
    signed_nda_url TEXT,
    signed_waiver_url TEXT,

    -- Notifications
    host_notified_at TIMESTAMP,

    -- Check-out details
    checked_out_by UUID REFERENCES users(id) ON DELETE SET NULL,
    check_out_notes TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Documents / NDAs / Waivers
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) CHECK (type IN ('nda', 'waiver', 'policy', 'custom')),
    content TEXT NOT NULL,
    is_required BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Visit Documents (signed copies)
CREATE TABLE visit_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    visit_id UUID REFERENCES visits(id) ON DELETE CASCADE,
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    signature_url TEXT,
    signed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address INET
);

-- Deliveries
CREATE TABLE deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    recipient_name VARCHAR(100) NOT NULL,
    recipient_host_id UUID REFERENCES hosts(id) ON DELETE SET NULL,
    carrier VARCHAR(100),
    tracking_number VARCHAR(100),
    description TEXT,
    photo_url TEXT,
    label_scan_url TEXT,
    signed_for_by TEXT,
    signature_url TEXT,
    status VARCHAR(20) DEFAULT 'received' CHECK (status IN ('received', 'notified', 'collected', 'returned')),
    received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    collected_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Evacuation / Roll Call
CREATE TABLE evacuations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) DEFAULT 'drill' CHECK (type IN ('drill', 'real', 'test')),
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP,
    started_by UUID REFERENCES users(id) ON DELETE SET NULL,
    assembly_point TEXT,
    notes TEXT,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled'))
);

CREATE TABLE evacuation_roll_calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    evacuation_id UUID REFERENCES evacuations(id) ON DELETE CASCADE,
    visit_id UUID REFERENCES visits(id) ON DELETE CASCADE,
    is_accounted BOOLEAN DEFAULT false,
    accounted_at TIMESTAMP,
    accounted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Audit Logs (immutable)
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    old_data JSONB,
    new_data JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Events (for event management feature)
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    location TEXT,
    start_date DATE NOT NULL,
    end_date DATE,
    start_time TIME,
    end_time TIME,
    max_attendees INTEGER,
    require_registration BOOLEAN DEFAULT true,
    badge_template TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE event_attendees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    company VARCHAR(100),
    registration_code VARCHAR(20) UNIQUE,
    checked_in_at TIMESTAMP,
    checked_out_at TIMESTAMP,
    custom_data JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_visits_org_status ON visits(org_id, status);
CREATE INDEX idx_visits_checked_in ON visits(org_id, checked_in_at);
CREATE INDEX idx_visits_badge ON visits(badge_number);
CREATE INDEX idx_hosts_org ON hosts(org_id);
CREATE INDEX idx_pre_reg_org ON pre_registered_visitors(org_id);
CREATE INDEX idx_deliveries_org ON deliveries(org_id);
CREATE INDEX idx_audit_org ON audit_logs(org_id, created_at);

-- Insert default visitor types
INSERT INTO visitor_types (org_id, name, description, badge_color, requires_nda) 
SELECT id, 'Guest', 'General visitor or guest', '#0D7377', false FROM organizations LIMIT 1;

INSERT INTO visitor_types (org_id, name, description, badge_color, requires_nda) 
SELECT id, 'Contractor', 'External contractor or vendor', '#FF6B35', true FROM organizations LIMIT 1;

INSERT INTO visitor_types (org_id, name, description, badge_color, requires_nda) 
SELECT id, 'Delivery', 'Package or delivery personnel', '#2ECC71', false FROM organizations LIMIT 1;

INSERT INTO visitor_types (org_id, name, description, badge_color, requires_nda) 
SELECT id, 'Interview Candidate', 'Job interview candidate', '#9B59B6', false FROM organizations LIMIT 1;
