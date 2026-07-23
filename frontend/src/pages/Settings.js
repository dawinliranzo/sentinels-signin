import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../utils/store';
import { Upload, Palette, Bell, Shield, Save, X, PenLine, HardDrive } from 'lucide-react';
import api from '../utils/api';
import { toast } from '../utils/toast';

// Default org settings blob — keep in one place so the "unsaved changes"
// tracker compares against a stable shape
const DEFAULTS = (orgName) => ({
  org_name: orgName || '',
  primary_color: '#0D7377',
  accent_color: '#FF6B35',
  notify_email: true,
  notify_sms: false,
  require_photo: false,
  require_nda: false,
  require_prereg_date: false,
  nda_text: '',
  badge_label: '',
  logo_data: '',
  custom_fields: [],
});

export default function Settings() {
  const org = useStore((s) => s.organization);
  const user = useStore((s) => s.user);
  const canManage = user?.role === 'admin' || user?.role === 'super_admin' || user?.switched || (user?.permissions || []).includes('settings');


  const [notifyOffline, setNotifyOffline] = useState(false);

  // Org settings blob + unsaved-changes tracking
  const [settings, setSettings] = useState(() => DEFAULTS(org?.name));
  const savedSnapshot = useRef(JSON.stringify(DEFAULTS(org?.name)));
  const dirty = JSON.stringify(settings) !== savedSnapshot.current;
  const logoInputRef = useRef(null);

  // MFA
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaSetup, setMfaSetup] = useState(null); // { secret, qr }
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaDisableCode, setMfaDisableCode] = useState('');

  // Test SMS + custom registration fields editor
  const [testPhone, setTestPhone] = useState('');
  const [smsBusy, setSmsBusy] = useState(false);
  const [newField, setNewField] = useState({ label: '', type: 'text', required: false, options: '' });

  // Daily backups (plan feature)
  const [backups, setBackups] = useState([]);
  const [backupsErr, setBackupsErr] = useState(null);

  useEffect(() => {
    if ((user?.features || []).includes('backups')) {
      api.get('/backups')
        .then(r => setBackups(r.data))
        .catch(e => setBackupsErr(e.response?.data?.error || 'Could not load backups'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const downloadBackup = async (id) => {
    try {
      const r = await api.get(`/backups/${id}/download`, { responseType: 'blob' });
      const dispo = r.headers['content-disposition'] || '';
      const name = (dispo.match(/filename="([^"]+)"/) || [])[1] || `backup-${id}.json`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(r.data);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast('Failed to download backup', 'error');
    }
  };

  const sendTestSms = async () => {
    if (!testPhone.trim()) return toast('Enter a phone number first', 'error');
    setSmsBusy(true);
    try {
      const r = await api.post('/settings/test-sms', { phone: testPhone.trim() });
      r.data.ok ? toast(r.data.message) : toast(r.data.message || 'SMS not sent', 'error');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to send test SMS', 'error');
    } finally {
      setSmsBusy(false);
    }
  };

  // Logo upload: read file, downscale to max 256px, store as data URL in the settings blob
  const handleLogoFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 256;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const out = file.type === 'image/png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85);
        setSettings(s => ({ ...s, logo_data: out }));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const startMfaSetup = async () => {
    setMfaBusy(true);
    try {
      const res = await api.post('/auth/mfa/setup');
      setMfaSetup(res.data);
      setMfaCode('');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to start MFA setup', 'error');
    } finally {
      setMfaBusy(false);
    }
  };

  const enableMfa = async () => {
    if (!mfaCode) return toast('Enter the 6-digit code from your authenticator app', 'error');
    setMfaBusy(true);
    try {
      await api.post('/auth/mfa/enable', { code: mfaCode });
      setMfaEnabled(true);
      setMfaSetup(null);
      setMfaCode('');
      toast('MFA enabled — you will need your code at next login');
    } catch (err) {
      toast(err.response?.data?.error || 'Invalid code', 'error');
    } finally {
      setMfaBusy(false);
    }
  };

  const disableMfa = async () => {
    if (!mfaDisableCode.trim()) return toast('Enter your current 6-digit code to disable MFA', 'error');
    setMfaBusy(true);
    try {
      await api.post('/auth/mfa/disable', { code: mfaDisableCode.trim() });
      setMfaEnabled(false);
      setMfaDisableCode('');
      toast('MFA disabled — your account is protected by password only');
    } catch (err) {
      toast(err.response?.data?.error || 'Invalid code', 'error');
    } finally {
      setMfaBusy(false);
    }
  };

  const toggleOfflineAlerts = async (value) => {
    setNotifyOffline(value);
    try {
      await api.patch('/auth/me/preferences', { notify_offline: value });
    } catch (err) {
      setNotifyOffline(!value); // revert on failure
      toast(err.response?.data?.error || 'Failed to save preference', 'error');
    }
  };

  useEffect(() => {
    api.get('/auth/me').then(r => { setNotifyOffline(!!r.data.notify_offline); setMfaEnabled(!!r.data.mfa_enabled); }).catch(() => {});
    api.get('/settings').then(r => {
      if (r.data && Object.keys(r.data).length > 0) {
        const merged = { ...DEFAULTS(org?.name), ...r.data };
        setSettings(merged);
        savedSnapshot.current = JSON.stringify(merged);
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch('/settings', settings);
      savedSnapshot.current = JSON.stringify(settings); // no longer dirty
      toast('Settings saved');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
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
            <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoFile} style={{ display: 'none' }} />
            {settings.logo_data ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <img src={settings.logo_data} alt="Organization logo"
                  style={{ width: 120, height: 120, objectFit: 'contain', borderRadius: 16, border: '1px solid #E2E8F0', background: '#fff', padding: 8 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button type="button" onClick={() => logoInputRef.current?.click()}
                    style={{ padding: '9px 16px', borderRadius: 10, background: '#F1F5F9', border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', color: '#334155' }}>
                    Replace logo
                  </button>
                  <button type="button" onClick={() => setSettings({ ...settings, logo_data: '' })}
                    style={{ padding: '9px 16px', borderRadius: 10, background: '#FEF2F2', border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', color: '#991B1B', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <X size={14} /> Remove
                  </button>
                </div>
              </div>
            ) : (
              <div onClick={() => logoInputRef.current?.click()} style={{
                width: 120, height: 120, borderRadius: 16, border: '2px dashed #E2E8F0',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                color: '#64748B', cursor: 'pointer', gap: 8
              }}>
                <Upload size={24} />
                <span style={{ fontSize: 12 }}>Upload logo</span>
              </div>
            )}
            <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 8 }}>
              Shown on the kiosk welcome screen. Any image works — it's resized automatically. Save Settings to apply.
            </div>
          </div>
          <div>
            <label style={labelStyle}>Badge label</label>
            <input type="text" value={settings.badge_label || ''} placeholder="EMPLOYEE BADGE"
              onChange={(e) => setSettings({...settings, badge_label: e.target.value})}
              style={inputStyle} />
            <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 6 }}>
              What you call the people who receive visitors — printed at the top of their ID badges.
              Examples: "Sentinels Employee", "Tenant — Building 1". Leave empty for "EMPLOYEE BADGE".
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
          <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', paddingTop: 12, borderTop: '1px solid #F1F5F9' }}>
            <input type="checkbox" checked={notifyOffline}
              onChange={(e) => toggleOfflineAlerts(e.target.checked)}
              style={{ width: 22, height: 22 }} />
            <div>
              <div style={{ fontWeight: 600, color: '#0F172A' }}>Kiosk Offline Alerts</div>
              <div style={{ fontSize: 13, color: '#64748B' }}>Email me if the kiosk stops responding (10+ min), and when it comes back online · <strong>this one saves immediately, no Save needed</strong></div>
            </div>
          </label>

          {/* Test SMS — verifies the Twilio env vars on Render actually work */}
          <div style={{ marginTop: 16, padding: 16, borderRadius: 12, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
            <div style={{ fontWeight: 600, color: '#0F172A', marginBottom: 4 }}>Test SMS</div>
            <div style={{ fontSize: 12, color: '#64748B', marginBottom: 10 }}>
              Verify your Twilio setup — sends one text from your Twilio number. Include the country code (e.g. +1347…).
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input type="tel" placeholder="+1…" value={testPhone} onChange={(e) => setTestPhone(e.target.value)}
                style={{ ...inputStyle, flex: 1, minWidth: 180 }} />
              <button type="button" onClick={sendTestSms} disabled={smsBusy}
                style={{ padding: '12px 20px', borderRadius: 10, background: '#0D7377', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
                {smsBusy ? 'Sending…' : 'Send Test SMS'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Registration Form — custom fields per organization */}
      <div style={sectionStyle}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
          <PenLine size={20} color="#0D7377" /> Registration Form
        </h3>
        <p style={{ fontSize: 13, color: '#64748B', marginBottom: 16, lineHeight: 1.5 }}>
          Extra questions asked on the kiosk during check-in — every organization can have its own
          (e.g. an apartment building asks "Apartment #", a school asks "Student ID").
          Answers are stored with each visit (Visits → eye icon). Remember to Save Settings after editing.
        </p>

        {(settings.custom_fields || []).map((f, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#F8FAFC', borderRadius: 10, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 600, fontSize: 14, color: '#0F172A' }}>{f.label}</span>
              <span style={{ fontSize: 12, color: '#64748B', marginLeft: 8 }}>
                {f.type}{f.required ? ' · required' : ''}{f.type === 'dropdown' ? ` · ${(f.options || []).join(', ')}` : ''}
              </span>
            </div>
            <button type="button" onClick={() => setSettings({ ...settings, custom_fields: settings.custom_fields.filter((_, j) => j !== i) })}
              style={{ padding: '6px 12px', borderRadius: 8, background: '#FEF2F2', border: 'none', color: '#991B1B', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Remove
            </button>
          </div>
        ))}

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginTop: 12 }}>
          <input type="text" placeholder="Field label — e.g. Apartment #" value={newField.label}
            onChange={(e) => setNewField({ ...newField, label: e.target.value })} style={inputStyle} />
          <select value={newField.type} onChange={(e) => setNewField({ ...newField, type: e.target.value })} style={{ ...inputStyle, background: '#fff' }}>
            <option value="text">Text answer</option>
            <option value="dropdown">Dropdown (choices)</option>
            <option value="checkbox">Checkbox (yes/no)</option>
          </select>
        </div>
        {newField.type === 'dropdown' && (
          <input type="text" placeholder="Choices, comma separated — e.g. Building 1, Building 2, Building 3" value={newField.options}
            onChange={(e) => setNewField({ ...newField, options: e.target.value })} style={{ ...inputStyle, marginTop: 10 }} />
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, flexWrap: 'wrap', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#334155', cursor: 'pointer' }}>
            <input type="checkbox" checked={newField.required} onChange={(e) => setNewField({ ...newField, required: e.target.checked })} />
            Required (visitor can't continue without answering)
          </label>
          <button type="button" onClick={() => {
            if (!newField.label.trim()) return toast('Give the field a label first', 'error');
            const field = { label: newField.label.trim(), type: newField.type, required: newField.required };
            if (newField.type === 'dropdown') {
              field.options = newField.options.split(',').map(o => o.trim()).filter(Boolean);
              if (field.options.length === 0) return toast('Add at least one choice for the dropdown', 'error');
            }
            setSettings({ ...settings, custom_fields: [...(settings.custom_fields || []), field] });
            setNewField({ label: '', type: 'text', required: false, options: '' });
          }}
            style={{ padding: '10px 20px', borderRadius: 10, background: '#0D7377', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
            + Add Field
          </button>
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
            <input type="checkbox" checked={settings.require_prereg_date || false}
              onChange={(e) => setSettings({...settings, require_prereg_date: e.target.checked})}
              style={{ width: 22, height: 22 }} />
            <div>
              <div style={{ fontWeight: 600, color: '#0F172A' }}>Require Date for Pre-Registrations</div>
              <div style={{ fontSize: 13, color: '#64748B' }}>Off by default — pre-registered visitors can have open-ended visits with no expected date/time</div>
            </div>
          </label>

          {/* ─── MFA ─── */}
          <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: 16, marginTop: 4 }}>
            <div style={{ fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>Two-Factor Authentication (MFA)</div>
            <div style={{ fontSize: 13, color: '#64748B', marginBottom: 12 }}>
              Status: <strong style={{ color: mfaEnabled ? '#166534' : '#92400E' }}>{mfaEnabled ? 'Enabled' : 'Disabled'}</strong>
              {' '}— protects your account with an authenticator app (Google Authenticator, Authy, 1Password...)
            </div>

            {!mfaEnabled && !mfaSetup && (
              <button onClick={startMfaSetup} disabled={mfaBusy}
                style={{ padding: '10px 20px', borderRadius: 10, background: '#0D7377', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
                {mfaBusy ? 'Preparing...' : 'Set Up MFA'}
              </button>
            )}

            {mfaSetup && (
              <div style={{ background: '#F8FAFC', borderRadius: 12, padding: 16, marginTop: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>1. Scan with your authenticator app:</div>
                <img src={mfaSetup.qr} alt="MFA QR" style={{ width: 180, height: 180, display: 'block', marginBottom: 8 }} />
                <div style={{ fontSize: 12, color: '#64748B', marginBottom: 12 }}>
                  Can't scan? Enter manually: <code style={{ background: '#fff', padding: '2px 8px', borderRadius: 6, border: '1px solid #E2E8F0' }}>{mfaSetup.secret}</code>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>2. Enter the 6-digit code:</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input type="text" inputMode="numeric" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} placeholder="123456"
                    style={{ padding: '12px 16px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 18, letterSpacing: 6, width: 160, textAlign: 'center' }} />
                  <button onClick={enableMfa} disabled={mfaBusy}
                    style={{ padding: '12px 20px', borderRadius: 10, background: '#166534', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                    Verify & Enable
                  </button>
                  <button onClick={() => { setMfaSetup(null); setMfaCode(''); }}
                    style={{ padding: '12px 16px', borderRadius: 10, background: '#F1F5F9', border: 'none', cursor: 'pointer' }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {mfaEnabled && (
              <div style={{ background: '#F8FAFC', borderRadius: 12, padding: 16, marginTop: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: '#0F172A' }}>Disable MFA</div>
                <div style={{ fontSize: 12, color: '#64748B', marginBottom: 10 }}>
                  Enter your current 6-digit authenticator code to confirm. Your account will be protected by password only.
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input type="text" inputMode="numeric" value={mfaDisableCode} onChange={(e) => setMfaDisableCode(e.target.value)} placeholder="123456"
                    style={{ padding: '12px 16px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 18, letterSpacing: 6, width: 160, textAlign: 'center' }} />
                  <button onClick={disableMfa} disabled={mfaBusy}
                    style={{ padding: '12px 20px', borderRadius: 10, background: '#FEF2F2', border: 'none', color: '#991B1B', fontWeight: 600, cursor: 'pointer' }}>
                    {mfaBusy ? 'Checking…' : 'Disable MFA'}
                  </button>
                </div>
              </div>
            )}

            {canManage && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', marginTop: 16, paddingTop: 12, borderTop: '1px solid #F1F5F9' }}>
                <input type="checkbox" checked={settings.mfa_required || false}
                  onChange={(e) => setSettings({...settings, mfa_required: e.target.checked})}
                  style={{ width: 22, height: 22 }} />
                <div>
                  <div style={{ fontWeight: 600, color: '#0F172A' }}>Require MFA for everyone in this organization</div>
                  <div style={{ fontSize: 13, color: '#64748B' }}>Users without MFA will be sent to set it up at next login (remember to Save Settings below)</div>
                </div>
              </label>
            )}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={settings.require_nda}
              onChange={(e) => setSettings({...settings, require_nda: e.target.checked})}
              style={{ width: 22, height: 22 }} />
            <div>
              <div style={{ fontWeight: 600, color: '#0F172A' }}>Require NDA Signing</div>
              <div style={{ fontSize: 13, color: '#64748B' }}>Visitors must sign an NDA before entry</div>
            </div>
          </label>

          {settings.require_nda && (
            <div style={{ marginTop: 16, padding: 20, borderRadius: 12, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
              <div style={{ fontWeight: 600, color: '#0F172A', marginBottom: 6 }}>NDA Document</div>
              <div style={{ fontSize: 13, color: '#64748B', marginBottom: 12, lineHeight: 1.5 }}>
                This text is shown on the kiosk during check-in — for both walk-in visitors and
                pre-registered visitors scanning their QR code. The visitor signs with their finger
                on the kiosk screen and can't complete check-in without signing.
                Each signed copy (signature image + typed name + exact text signed + date/time) is
                stored with the visit — open <strong>Visits</strong> and click the NDA icon on any row to view it.
              </div>
              <textarea
                rows={10}
                value={settings.nda_text || ''}
                placeholder={'VISITOR NON-DISCLOSURE AGREEMENT\n\nBy signing below, the visitor agrees to keep confidential all non-public information, materials, and activities observed or accessed while on these premises.\n\nThe visitor agrees not to disclose, copy, photograph, record, or share any such information with any third party, and to follow all site safety and security rules for the duration of the visit.\n\nThis agreement takes effect upon signing and remains in effect after the visit ends.'}
                onChange={(e) => setSettings({...settings, nda_text: e.target.value})}
                style={{
                  width: '100%', padding: '12px 16px', borderRadius: 10,
                  border: '2px solid #E2E8F0', fontSize: 14, lineHeight: 1.6,
                  outline: 'none', resize: 'vertical', fontFamily: 'inherit'
                }}
              />
              <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 8 }}>
                Leave empty to use the default agreement shown above. Remember to click Save Settings.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Daily Backups — included in the plan (Enterprise / add-on) */}
      {(user?.features || []).includes('backups') && (
        <div style={{
          background: '#fff', borderRadius: 16, padding: 24, marginBottom: 20,
          boxShadow: '0 2px 10px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0'
        }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
            <HardDrive size={20} color="#0D7377" /> Daily Backups
          </h3>
          <p style={{ fontSize: 13, color: '#64748B', marginBottom: 16, lineHeight: 1.5 }}>
            A full snapshot of your organization (users, hosts, visits, devices, settings) is taken every night at 03:00 UTC and kept for 30 days.
            Download any snapshot for your records. Restores are performed by Sentinels support.
          </p>
          {backupsErr && (
            <div style={{ fontSize: 13, color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
              {backupsErr}
            </div>
          )}
          {backups.length === 0 && !backupsErr ? (
            <p style={{ fontSize: 13, color: '#94A3B8' }}>No snapshots yet — the first one lands after tonight's 03:00 UTC run.</p>
          ) : (
            backups.slice(0, 10).map(b => (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 14px', background: '#F8FAFC', borderRadius: 10, marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: '#0F172A' }}>{new Date(b.created_at).toLocaleString()}</span>
                <span style={{ fontSize: 12, color: '#64748B' }}>
                  {b.kind}{b.counts ? ` · ${b.counts.users ?? 0} users, ${b.counts.hosts ?? 0} hosts, ${b.counts.visits ?? 0} visits` : ''}
                </span>
                <button onClick={() => downloadBackup(b.id)}
                  style={{ marginLeft: 'auto', padding: '7px 14px', borderRadius: 8, background: '#F0FDFA', border: '1px solid #5EEAD4', color: '#0F766E', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  Download
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {dirty && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 18px', borderRadius: 12, marginBottom: 16,
          background: '#FFFBEB', border: '1px solid #FDE68A',
          color: '#92400E', fontSize: 14, fontWeight: 600
        }}>
          ⚠ You have unsaved changes — they won't apply until you click Save Settings. Switching tabs discards them.
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '14px 32px', borderRadius: 12,
          background: saving ? '#94A3B8' : dirty ? '#D97706' : '#0D7377', border: 'none', color: '#fff',
          fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', fontSize: 16
        }}
      >
        <Save size={18} /> {saving ? 'Saving...' : 'Save Settings'}
      </button>
    </div>
  );
}
