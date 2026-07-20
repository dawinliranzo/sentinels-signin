import React, { useState, useEffect } from 'react';
import { useStore } from '../utils/store';
import { Users, UserPlus, Shield, ShieldCheck, ShieldOff } from 'lucide-react';
import api from '../utils/api';
import { toast } from '../utils/toast';

const inputStyle = {
  width: '100%', padding: '12px 16px', borderRadius: 10,
  border: '2px solid #E2E8F0', fontSize: 14, outline: 'none'
};

export default function Team() {
  const user = useStore((s) => s.user);
  const canManage = user?.role === 'admin' || user?.role === 'super_admin';

  const [team, setTeam] = useState([]);
  const [newUser, setNewUser] = useState({ first_name: '', last_name: '', email: '', role: 'receptionist' });
  const [teamMsg, setTeamMsg] = useState(null);
  const [tempPw, setTempPw] = useState(null);
  const [savingUser, setSavingUser] = useState(false);
  const [confirmMfaId, setConfirmMfaId] = useState(null);

  useEffect(() => {
    if (canManage) loadTeam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  const loadTeam = async () => {
    try {
      const r = await api.get('/users');
      setTeam(r.data);
    } catch {
      toast('Failed to load team members', 'error');
    }
  };

  const addUser = async () => {
    if (!newUser.first_name || !newUser.last_name || !newUser.email) {
      toast('Fill in name and email for the new user', 'error');
      return;
    }
    setSavingUser(true);
    setTeamMsg(null);
    setTempPw(null);
    try {
      const res = await api.post('/users', newUser);
      setNewUser({ first_name: '', last_name: '', email: '', role: 'receptionist' });
      setTempPw({ email: res.data.email, password: res.data.temp_password, emailed: res.data.invite_sent });
      loadTeam();
    } catch (err) {
      setTeamMsg({ ok: false, text: err.response?.data?.error || 'Failed to create user' });
    } finally {
      setSavingUser(false);
    }
  };

  const resetPw = async (u) => {
    if (!window.confirm(`Reset password for ${u.email}? They will get an 8-character temporary password and must set a new one on next sign-in.`)) return;
    try {
      const res = await api.post(`/users/${u.id}/reset-password`);
      setTempPw({ email: res.data.user_email, password: res.data.temp_password, emailed: res.data.invite_sent });
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to reset password', 'error');
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

  const toggleMfaRequire = async (u) => {
    try {
      const res = await api.patch(`/users/${u.id}/mfa-require`, { required: !u.mfa_required });
      toast(res.data.mfa_required
        ? `MFA required for ${u.email} — they'll be asked to set it up at next sign-in`
        : `MFA requirement removed for ${u.email}`);
      loadTeam();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to update MFA requirement', 'error');
    }
  };

  const toggleActive = async (u) => {
    if (!window.confirm(`${u.is_active ? 'Deactivate' : 'Reactivate'} ${u.email}?`)) return;
    try {
      await api.patch(`/users/${u.id}/status`, { is_active: !u.is_active });
      loadTeam();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to update user', 'error');
    }
  };

  if (!canManage) {
    return (
      <div style={{ background: '#fff', borderRadius: 16, padding: 40, textAlign: 'center', color: '#64748B' }}>
        You need an admin account to manage team members.
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0F172A' }}>Team</h1>
        <p style={{ color: '#64748B', marginTop: 4 }}>Invite people, manage access, and control each member's MFA</p>
      </div>

      <div style={{ background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 2px 10px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0' }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Users size={20} color="#0D7377" /> Team Members
        </h3>

        {team.map(u => (
          <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#F8FAFC', borderRadius: 12, marginBottom: 10, flexWrap: 'wrap', gap: 10 }}>
            <div style={{ minWidth: 220 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#0F172A' }}>
                {u.first_name} {u.last_name}{' '}
                <span style={{ fontSize: 11, color: '#64748B', fontWeight: 400 }}>({u.role}{!u.is_active ? ' · inactive' : ''})</span>
              </div>
              <div style={{ fontSize: 12, color: '#64748B' }}>{u.email}</div>
              <div style={{ marginTop: 6 }}>
                {u.mfa_enabled ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#DCFCE7', color: '#166534' }}>
                    <ShieldCheck size={12} /> MFA ON
                  </span>
                ) : u.mfa_required ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#FEF3C7', color: '#92400E' }}>
                    <Shield size={12} /> MFA REQUIRED — setup at next sign-in
                  </span>
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#F1F5F9', color: '#64748B' }}>
                    <ShieldOff size={12} /> MFA OFF
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => resetPw(u)} style={{ padding: '8px 14px', borderRadius: 8, background: '#FEF3C7', border: 'none', color: '#92400E', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Reset Password
              </button>

              {/* MFA: reset when enabled; require/unrequire when not */}
              {u.mfa_enabled ? (confirmMfaId === u.id ? (
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
              )) : (
                <button onClick={() => toggleMfaRequire(u)} title={u.mfa_required ? 'Remove the MFA requirement' : 'Force this person to set up MFA at next sign-in'}
                  style={{ padding: '8px 14px', borderRadius: 8, background: u.mfa_required ? '#F1F5F9' : '#E0E7FF', border: 'none', color: u.mfa_required ? '#64748B' : '#3730A3', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  {u.mfa_required ? 'Unrequire MFA' : 'Require MFA'}
                </button>
              )}

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
            <div style={{ fontSize: 12, color: '#047857', marginBottom: 8 }}>
              {tempPw.emailed
                ? '✓ Also sent to them by email — they\'ll be asked to set a new password on first sign-in'
                : '⚠ Email not sent (check SENDGRID_API_KEY on Render) — share this password with them manually'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <code style={{ fontSize: 18, fontWeight: 700, background: '#fff', padding: '6px 14px', borderRadius: 8, border: '1px solid #A7F3D0' }}>{tempPw.password}</code>
              <button onClick={() => navigator.clipboard.writeText(tempPw.password)} style={{ padding: '8px 12px', borderRadius: 8, background: '#059669', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Copy</button>
            </div>
            <div style={{ fontSize: 12, color: '#047857', marginTop: 8 }}>Shown once — share it with the user and ask them to change it after logging in.</div>
          </div>
        )}

        <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid #E2E8F0' }}>
          <h4 style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <UserPlus size={18} color="#0D7377" /> Invite Member
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
            <input type="text" placeholder="First name" value={newUser.first_name} onChange={(e) => setNewUser({...newUser, first_name: e.target.value})} style={inputStyle} />
            <input type="text" placeholder="Last name" value={newUser.last_name} onChange={(e) => setNewUser({...newUser, last_name: e.target.value})} style={inputStyle} />
            <input type="email" placeholder="Email" value={newUser.email} onChange={(e) => setNewUser({...newUser, email: e.target.value})} style={inputStyle} />
            <select value={newUser.role} onChange={(e) => setNewUser({...newUser, role: e.target.value})} style={{ ...inputStyle, background: '#fff' }}>
              <option value="receptionist">Receptionist</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div style={{ fontSize: 12, color: '#64748B', marginBottom: 12 }}>
            📧 They'll receive an email with an 8-character temporary password and be asked to set their own on first sign-in
          </div>
          {teamMsg && (
            <div style={{ fontSize: 13, fontWeight: 600, color: teamMsg.ok ? '#166534' : '#991B1B', marginBottom: 12 }}>{teamMsg.text}</div>
          )}
          <button onClick={addUser} disabled={savingUser} style={{ padding: '12px 24px', borderRadius: 10, background: savingUser ? '#94A3B8' : '#0D7377', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
            {savingUser ? 'Sending invite...' : 'Invite Member'}
          </button>
        </div>
      </div>
    </div>
  );
}
