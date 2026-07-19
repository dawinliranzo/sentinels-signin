import React, { useState, useEffect } from 'react';
import { useStore } from '../utils/store';
import { Upload, Palette, Bell, Shield, Save, Users, UserPlus } from 'lucide-react';
import api from '../utils/api';
import { toast } from '../utils/toast';

export default function Settings() {
  const org = useStore((s) => s.organization);
  const user = useStore((s) => s.user);
  const canManage = user?.role === 'admin' || user?.role === 'super_admin';

  const [team, setTeam] = useState([]);
  const [newUser, setNewUser] = useState({ first_name: '', last_name: '', email: '', password: '', role: 'receptionist' });
  const [teamMsg, setTeamMsg] = useState(null);
  const [tempPw, setTempPw] = useState(null);
  const [savingUser, setSavingUser] = useState(false);
  const [notifyOffline, setNotifyOffline] = useState(false);
  const [confirmMfaId, setConfirmMfaId] = useState(null);

  // MFA
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaSetup, setMfaSetup] = useState(null); // { secret, qr }
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);

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
    if (!mfaCode) return alert('Enter the 6-digit code from your authenticator app');
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
    if (!window.confirm('Disable MFA? Your account will be protected by password only.')) return;
    const code = window.prompt('Enter your current 6-digit code to confirm:');
    if (!code) return;
    try {
      await api.post('/auth/mfa/disable', { code });
      setMfaEnabled(false);
      toast('MFA disabled');
    } catch (err) {
      toast(err.response?.data?.error || 'Invalid code', 'error');
    }
  };

  const toggleOfflineAlerts = async (value) => {
    setNotifyOffline(value);
    try {
      await api.patch('/auth/me/preferences', { notify_offline: value });
    } catch (err) {
      setNotifyOffline(!value); // revert on failure
      alert(err.response?.data?.error || 'Failed to save preference — the database may need the offline-alerts migration');
    }
  };

  useEffect(() => {
    if (canManage) loadTeam();
    api.get('/auth/me').then(r => { setNotifyOffline(!!r.data.notify_offline); setMfaEnabled(!!r.data.mfa_enabled); }).catch(() => {});
    api.get('/settings').then(r => {
      if (r.data && Object.keys(r.data).length > 0) {
        setSettings(prev => ({ ...prev, ...r.data }));
      }
    }).catch(() => {});
  }, []);

  const loadTeam = async () => {
    try {
      const res = await api.get('/users');
      setTeam(res.data);
    } catch (err) {
      console.error('Failed to load team:', err);
    }
  };

  const addUser = async () => {
    if (!newUser.first_name || !newUser.last_name || !newUser.email || !newUser.password) {
      alert('Fill in all fields for the new user');
      return;
    }
    setSavingUser(true);
    setTeamMsg(null);
    try {
      await api.post('/users', newUser);
      setNewUser({ first_name: '', last_name: '', email: '', password: '', role: 'receptionist' });
      setTeamMsg({ ok: true, text: 'User created' });
      loadTeam();
    } catch (err) {
      setTeamMsg({ ok: false, text: err.response?.data?.error || 'Failed to create user' });
    } finally {
      setSavingUser(false);
    }
  };

  const resetPw = async (u) => {
    if (!window.confirm(`Reset password for ${u.first_name} ${u.last_name}?`)) return;
    try {
      const res = await api.post(`/users/${u.id}/reset-password`);
      setTempPw({ email: res.data.user_email, password: res.data.temp_password });
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to reset password');
    }
  };

  const resetMfa = async (u) => {
    try {
      const res = await api.post(`/users/${u.id}/reset-mfa`);
      setConfirmMfaId(null);
      toast(res.data.already_disabled
        ? `MFA is already off for ${u.email}`
        : `MFA reset for ${u.email} — they can sign in with password only and set MFA up again`);
      loadTeam();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to reset MFA', 'error');
    }
  };

  const toggleActive = async (u) => {
    const action = u.is_active ? 'deactivate' : 'reactivate';
    if (!window.confirm(`${action === 'deactivate' ? 'Deactivate' : 'Reactivate'} ${u.first_name} ${u.last_name}?`)) return;
    try {
      await api.patch(`/users/${u.id}/status`, { is_active: !u.is_active });
      loadTeam();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update user');
    }
  };
  const [settings, setSettings] = useState({
    org_name: org?.name || '',
    primary_color: '#0D7377',
    accent_color: '#FF6B35',
    notify_email: true,
    notify_sms: false,
    require_photo: false,
    require_nda: false,
    require_prereg_date: false,
  });

  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch('/settings', settings);
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

      {/* Team Members */}
      {canManage && (
        <div style={sectionStyle}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Users size={20} color="#0D7377" /> Team Members
          </h3>

          {team.map(u => (
            <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: '#F8FAFC', borderRadius: 10, marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#0F172A' }}>
                  {u.first_name} {u.last_name} <span style={{ fontSize: 11, color: '#64748B', fontWeight: 400 }}>({u.role}{!u.is_active ? ' · inactive' : ''})</span>
                </div>
                <div style={{ fontSize: 12, color: '#64748B' }}>{u.email}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => resetPw(u)} style={{ padding: '8px 14px', borderRadius: 8, background: '#FEF3C7', border: 'none', color: '#92400E', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Reset Password
                </button>
                {u.mfa_enabled && (confirmMfaId === u.id ? (
                  <>
                    <button onClick={() => resetMfa(u)} style={{ padding: '8px 14px', borderRadius: 8, background: '#3730A3', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      Confirm MFA reset
                    </button>
                    <button onClick={() => setConfirmMfaId(null)} style={{ padding: '8px 14px', borderRadius: 8, background: '#F1F5F9', border: 'none', fontSize: 12, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button onClick={() => setConfirmMfaId(u.id)} title="Use when this person loses access to their authenticator"
                    style={{ padding: '8px 14px', borderRadius: 8, background: '#E0E7FF', border: 'none', color: '#3730A3', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    Reset MFA
                  </button>
                ))}
                {u.id !== user?.id && (
                  <button onClick={() => toggleActive(u)} style={{ padding: '8px 14px', borderRadius: 8, background: u.is_active ? '#FEF2F2' : '#DCFCE7', border: 'none', color: u.is_active ? '#991B1B' : '#166534', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    {u.is_active ? 'Deactivate' : 'Reactivate'}
                  </button>
                )}
              </div>
            </div>
          ))}

          {tempPw && (
            <div style={{ padding: 16, background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 12, marginTop: 12, marginBottom: 12 }}>
              <div style={{ fontWeight: 700, color: '#065F46', marginBottom: 8, fontSize: 14 }}>Temporary password for {tempPw.email}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <code style={{ fontSize: 18, fontWeight: 700, background: '#fff', padding: '6px 14px', borderRadius: 8, border: '1px solid #A7F3D0' }}>{tempPw.password}</code>
                <button onClick={() => navigator.clipboard.writeText(tempPw.password)} style={{ padding: '8px 12px', borderRadius: 8, background: '#059669', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Copy</button>
              </div>
              <div style={{ fontSize: 12, color: '#047857', marginTop: 8 }}>Shown once — share it with the user and ask them to change it after logging in.</div>
            </div>
          )}

          <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid #E2E8F0' }}>
            <h4 style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <UserPlus size={18} color="#0D7377" /> Add User
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
              <input type="text" placeholder="First name" value={newUser.first_name} onChange={(e) => setNewUser({...newUser, first_name: e.target.value})} style={inputStyle} />
              <input type="text" placeholder="Last name" value={newUser.last_name} onChange={(e) => setNewUser({...newUser, last_name: e.target.value})} style={inputStyle} />
              <input type="email" placeholder="Email" value={newUser.email} onChange={(e) => setNewUser({...newUser, email: e.target.value})} style={inputStyle} />
              <input type="text" placeholder="Temporary password (min 8 chars)" value={newUser.password} onChange={(e) => setNewUser({...newUser, password: e.target.value})} style={inputStyle} />
              <select value={newUser.role} onChange={(e) => setNewUser({...newUser, role: e.target.value})} style={{ ...inputStyle, background: '#fff' }}>
                <option value="receptionist">Receptionist</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            {teamMsg && (
              <div style={{ fontSize: 13, fontWeight: 600, color: teamMsg.ok ? '#166534' : '#991B1B', marginBottom: 12 }}>{teamMsg.text}</div>
            )}
            <button onClick={addUser} disabled={savingUser} style={{ padding: '12px 24px', borderRadius: 10, background: '#0D7377', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
              {savingUser ? 'Adding...' : 'Add User'}
            </button>
          </div>
        </div>
      )}

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
              <div style={{ fontSize: 13, color: '#64748B' }}>Email me if the kiosk stops responding (10+ min), and when it comes back online</div>
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
              <button onClick={disableMfa}
                style={{ padding: '10px 20px', borderRadius: 10, background: '#FEF2F2', border: 'none', color: '#991B1B', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
                Disable MFA
              </button>
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
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '14px 32px', borderRadius: 12,
          background: saving ? '#94A3B8' : '#0D7377', border: 'none', color: '#fff',
          fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', fontSize: 16
        }}
      >
        <Save size={18} /> {saving ? 'Saving...' : 'Save Settings'}
      </button>
    </div>
  );
}
