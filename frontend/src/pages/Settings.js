import React, { useState } from 'react';
import { useStore } from '../utils/store';
import { Upload, Palette, Bell, Shield, Save } from 'lucide-react';

export default function Settings() {
  const org = useStore((s) => s.organization);
  const [settings, setSettings] = useState({
    org_name: org?.name || '',
    primary_color: '#0D7377',
    accent_color: '#FF6B35',
    notify_email: true,
    notify_sms: false,
    require_photo: false,
    require_nda: false,
  });

  const handleSave = () => {
    alert('Settings saved! (In production, this would update the database)');
  };

  const sectionStyle = {
    background: '#fff', borderRadius: 16, padding: 24,
    marginBottom: 24, boxShadow: '0 2px 10px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0'
  };

  const labelStyle = { display: 'block', fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 8 };
  const inputStyle = {
    width: '100%', padding: '12px 16px', borderRadius: 10,
    border: '2px solid #E2E8F0', fontSize: 14, outline: 'none'
  };

  return (
    <div>
      <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0F172A', marginBottom: 24 }}>Settings</h1>

      {/* Branding */}
      <div style={sectionStyle}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Palette size={20} color="#0D7377" /> Branding
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelStyle}>Organization Name</label>
            <input type="text" value={settings.org_name}
              onChange={(e) => setSettings({...settings, org_name: e.target.value})}
              style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Logo</label>
            <div style={{
              width: 120, height: 120, borderRadius: 16, border: '2px dashed #E2E8F0',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              color: '#64748B', cursor: 'pointer', gap: 8
            }}>
              <Upload size={24} />
              <span style={{ fontSize: 12 }}>Upload logo</span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={labelStyle}>Primary Color</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <input type="color" value={settings.primary_color}
                  onChange={(e) => setSettings({...settings, primary_color: e.target.value})}
                  style={{ width: 50, height: 50, border: 'none', borderRadius: 10, cursor: 'pointer' }} />
                <span style={{ fontSize: 14, color: '#64748B', fontFamily: 'monospace' }}>{settings.primary_color}</span>
              </div>
            </div>
            <div>
              <label style={labelStyle}>Accent Color</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <input type="color" value={settings.accent_color}
                  onChange={(e) => setSettings({...settings, accent_color: e.target.value})}
                  style={{ width: 50, height: 50, border: 'none', borderRadius: 10, cursor: 'pointer' }} />
                <span style={{ fontSize: 14, color: '#64748B', fontFamily: 'monospace' }}>{settings.accent_color}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div style={sectionStyle}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Bell size={20} color="#0D7377" /> Notifications
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={settings.notify_email}
              onChange={(e) => setSettings({...settings, notify_email: e.target.checked})}
              style={{ width: 22, height: 22 }} />
            <div>
              <div style={{ fontWeight: 600, color: '#0F172A' }}>Email Notifications</div>
              <div style={{ fontSize: 13, color: '#64748B' }}>Send email to hosts when visitors arrive</div>
            </div>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={settings.notify_sms}
              onChange={(e) => setSettings({...settings, notify_sms: e.target.checked})}
              style={{ width: 22, height: 22 }} />
            <div>
              <div style={{ fontWeight: 600, color: '#0F172A' }}>SMS Notifications</div>
              <div style={{ fontSize: 13, color: '#64748B' }}>Send SMS to hosts when visitors arrive</div>
            </div>
          </label>
        </div>
      </div>

      {/* Security */}
      <div style={sectionStyle}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Shield size={20} color="#0D7377" /> Security
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={settings.require_photo}
              onChange={(e) => setSettings({...settings, require_photo: e.target.checked})}
              style={{ width: 22, height: 22 }} />
            <div>
              <div style={{ fontWeight: 600, color: '#0F172A' }}>Require Photo Capture</div>
              <div style={{ fontSize: 13, color: '#64748B' }}>Take a photo of every visitor during check-in</div>
            </div>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={settings.require_nda}
              onChange={(e) => setSettings({...settings, require_nda: e.target.checked})}
              style={{ width: 22, height: 22 }} />
            <div>
              <div style={{ fontWeight: 600, color: '#0F172A' }}>Require NDA Signing</div>
              <div style={{ fontSize: 13, color: '#64748B' }}>Visitors must sign an NDA before entry</div>
            </div>
          </label>
        </div>
      </div>

      <button
        onClick={handleSave}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '14px 32px', borderRadius: 12,
          background: '#0D7377', border: 'none', color: '#fff',
          fontWeight: 600, cursor: 'pointer', fontSize: 16
        }}
      >
        <Save size={18} /> Save Settings
      </button>
    </div>
  );
}
