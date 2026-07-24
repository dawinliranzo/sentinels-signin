import React, { useState, useEffect } from 'react';
import { useStore } from '../utils/store';
import { Users, UserPlus, Shield, ShieldCheck, ShieldOff, Info, Plus, Trash2, KeyRound } from 'lucide-react';
import api from '../utils/api';
import { toast } from '../utils/toast';

const inputStyle = {
  width: '100%', padding: '12px 16px', borderRadius: 10,
  border: '2px solid #E2E8F0', fontSize: 14, outline: 'none'
};

// What each role can do — shown at the top so admins pick the right one
const ROLE_INFO = [
  { role: 'receptionist', label: 'Receptionist', text: 'Front-desk staff. Can view the dashboard and visits, check visitors in and out, and pre-register guests.' },
  { role: 'admin', label: 'Admin', text: 'Full control of this organization: hosts, devices, team invites, settings, compliance records.' },
  { role: 'super_admin', label: 'Super Admin', text: 'Sentinels staff only — manages ALL organizations on the platform (plans, status, every company). Never give this to a customer.' },
];

// Functions a custom role can be given — must match ALL_PERMISSIONS on the backend
const PERMISSION_OPTIONS = [
  { key: 'visits', label: 'Visits (view, check in/out)' },
  { key: 'prereg', label: 'Pre-registration' },
  { key: 'hosts', label: 'Hosts' },
  { key: 'devices', label: 'Kiosk devices' },
  { key: 'team', label: 'Team & roles' },
  { key: 'reports', label: 'Reports' },
  { key: 'compliance', label: 'Compliance / NDAs' },
  { key: 'settings', label: 'Settings' },
  { key: 'deliveries', label: 'Deliveries' },
];

export default function Team() {
  const user = useStore((s) => s.user);
  const canManage = user?.role === 'admin' || user?.role === 'super_admin' || user?.switched || (user?.permissions || []).includes('team');
  const isSuper = user?.role === 'super_admin';

  const [team, setTeam] = useState([]);
  const [newUser, setNewUser] = useState({ first_name: '', last_name: '', email: '', role: 'receptionist' });
  const [teamMsg, setTeamMsg] = useState(null);
  const [tempPw, setTempPw] = useState(null);
  const [savingUser, setSavingUser] = useState(false);
  // Generic inline confirm: { action: 'resetPw'|'toggleActive'|'mfaRequire'|'mfaReset'|'role'|'customRole'|'deleteRole', userId, user, role?, roleId?, roleName? }
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  // Custom roles
  const [roles, setRoles] = useState([]);
  const [rolesError, setRolesError] = useState(null);
  const [roleForm, setRoleForm] = useState({ name: '', permissions: [] });
  const [roleBusy, setRoleBusy] = useState(false);

  useEffect(() => {
    if (canManage) { loadTeam(); loadRoles(); }
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

  const loadRoles = async () => {
    try {
      const r = await api.get('/roles');
      setRoles(r.data);
      setRolesError(null);
    } catch (err) {
      setRolesError(err.response?.data?.error || 'Custom roles are unavailable');
    }
  };

  const togglePerm = (key) => {
    setRoleForm(f => ({
      ...f,
      permissions: f.permissions.includes(key) ? f.permissions.filter(p => p !== key) : [...f.permissions, key]
    }));
  };

  const createRole = async () => {
    if (!roleForm.name.trim()) return toast('Give the role a name', 'error');
    if (roleForm.permissions.length === 0) return toast('Select at least one function', 'error');
    setRoleBusy(true);
    try {
      await api.post('/roles', roleForm);
      setRoleForm({ name: '', permissions: [] });
      toast('Role created — assign it from each member\'s role dropdown');
      loadRoles();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to create role', 'error');
    } finally {
      setRoleBusy(false);
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
      const payload = { ...newUser };
      // Custom roles are selected as "custom:<role id>" — send the id separately
      // and keep the base role as receptionist
      if (payload.role.startsWith('custom:')) {
        payload.custom_role_id = payload.role.slice(7);
        payload.role = 'receptionist';
      }
      const res = await api.post('/users', payload);
      setNewUser({ first_name: '', last_name: '', email: '', role: 'receptionist' });
      setTempPw({ email: res.data.email, password: res.data.temp_password, emailed: res.data.invite_sent, emailError: res.data.email_error });
      loadTeam();
    } catch (err) {
      setTeamMsg({ ok: false, text: err.response?.data?.error || 'Failed to create user' });
    } finally {
      setSavingUser(false);
    }
  };

  // Executes whatever the inline confirm bar is confirming
  const runConfirmed = async () => {
    if (!confirm) return;
    setBusy(true);
    const u = confirm.user;
    try {
      if (confirm.action === 'resetPw') {
        const res = await api.post(`/users/${u.id}/reset-password`);
        setTempPw({ email: res.data.user_email, password: res.data.temp_password, emailed: res.data.invite_sent, emailError: res.data.email_error });
      } else if (confirm.action === 'toggleActive') {
        await api.patch(`/users/${u.id}/status`, { is_active: !u.is_active });
        toast(`${u.is_active ? 'Deactivated' : 'Reactivated'} ${u.email}`);
        loadTeam();
      } else if (confirm.action === 'mfaRequire') {
        const res = await api.patch(`/users/${u.id}/mfa-require`, { required: !u.mfa_required });
        toast(res.data.mfa_required
          ? `MFA required for ${u.email} — they'll be asked to set it up at next sign-in`
          : `MFA requirement removed for ${u.email}`);
        loadTeam();
      } else if (confirm.action === 'mfaReset') {
        const res = await api.post(`/users/${u.id}/reset-mfa`);
        toast(res.data.already_disabled
          ? `MFA is already off for ${u.email}`
          : `MFA reset for ${u.email} — they can sign in with password only and set MFA up again`);
        loadTeam();
      } else if (confirm.action === 'role') {
        await api.patch(`/users/${u.id}/role`, { role: confirm.role });
        toast(`${u.email} is now ${confirm.role === 'super_admin' ? 'a Super Admin' : confirm.role === 'admin' ? 'an Admin' : 'a Receptionist'}`);
        loadTeam();
      } else if (confirm.action === 'customRole') {
        await api.patch(`/users/${u.id}/role`, { custom_role_id: confirm.roleId });
        toast(`${u.email} now has the "${confirm.roleName}" role`);
        loadTeam();
      } else if (confirm.action === 'deleteRole') {
        await api.delete(`/roles/${confirm.roleId}`);
        toast(`Role "${confirm.roleName}" deleted`);
        loadRoles();
        loadTeam();
      }
      setConfirm(null);
    } catch (err) {
      toast(err.response?.data?.error || 'Action failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirmText = () => {
    if (!confirm) return '';
    const u = confirm.user;
    switch (confirm.action) {
      case 'resetPw': return `Reset password for ${u.email}? They'll receive an 8-character temporary password by email and must set a new one at next sign-in.`;
      case 'toggleActive': return u.is_active
        ? `Deactivate ${u.email}? They immediately lose access to the dashboard (their account and history are kept).`
        : `Reactivate ${u.email}? They regain access to the dashboard right away.`;
      case 'mfaRequire': return u.mfa_required
        ? `Remove the MFA requirement for ${u.email}? They'll be able to sign in with password only.`
        : `Require MFA for ${u.email}? They'll be forced to set up an authenticator app at next sign-in.`;
      case 'mfaReset': return `Reset MFA for ${u.email}? Use this when they lost their authenticator. Their current MFA setup is erased.`;
      case 'role': return `Change ${u.email} from ${u.role} to ${confirm.role}?${confirm.role === 'super_admin' ? ' Super admins can manage ALL organizations — Sentinels staff only.' : ''}`;
      case 'customRole': return `Give ${u.email} the "${confirm.roleName}" role? They'll get exactly the functions that role allows, and their menu will update at next sign-in.`;
      case 'deleteRole': return `Delete the "${confirm.roleName}" role? This only works while no members are assigned to it.`;
      default: return '';
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
        <p style={{ color: '#64748B', marginTop: 4 }}>Invite people, manage access and roles, and control each member's MFA</p>
      </div>

      {/* Invite — at the top so it's always one click away, no scrolling */}
      <div style={{ background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 2px 10px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0', marginBottom: 20 }}>
        <h4 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <UserPlus size={18} color="#0D7377" /> Invite Member
        </h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 12 }}>
          <input type="text" placeholder="First name" value={newUser.first_name} onChange={(e) => setNewUser({...newUser, first_name: e.target.value})} style={inputStyle} />
          <input type="text" placeholder="Last name" value={newUser.last_name} onChange={(e) => setNewUser({...newUser, last_name: e.target.value})} style={inputStyle} />
          <input type="email" placeholder="Email" value={newUser.email} onChange={(e) => setNewUser({...newUser, email: e.target.value})} style={inputStyle} />
          <select value={newUser.role} onChange={(e) => setNewUser({...newUser, role: e.target.value})} style={{ ...inputStyle, background: '#fff' }}>
            <option value="receptionist">Receptionist</option>
            <option value="admin">Admin</option>
            {roles.length > 0 && (
              <optgroup label="Custom roles">
                {roles.map(r => (
                  <option key={r.id} value={`custom:${r.id}`}>{r.name}</option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <div style={{ fontSize: 12, color: '#64748B', marginBottom: 12 }}>
          They'll receive an email with an 8-character temporary password and be asked to set their own on first sign-in
        </div>
        {teamMsg && (
          <div style={{ fontSize: 13, fontWeight: 600, color: teamMsg.ok ? '#166534' : '#991B1B', marginBottom: 12 }}>{teamMsg.text}</div>
        )}
        <button onClick={addUser} disabled={savingUser} style={{ padding: '12px 24px', borderRadius: 10, background: savingUser ? '#94A3B8' : '#0D7377', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
          {savingUser ? 'Sending invite...' : 'Invite Member'}
        </button>
      </div>

      {/* Temporary password result (invite or reset) */}
      {tempPw && (
        <div style={{ padding: 16, background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 12, marginBottom: 20 }}>
          <div style={{ fontWeight: 700, color: '#065F46', marginBottom: 8, fontSize: 14 }}>Temporary password for {tempPw.email}</div>
          <div style={{ fontSize: 12, color: '#047857', marginBottom: 8 }}>
            {tempPw.emailed
              ? '✓ Also sent to them by email — they\'ll be asked to set a new password on first sign-in'
              : `⚠ Email NOT delivered${tempPw.emailError ? ` (${tempPw.emailError})` : ''} — share this password manually, and check SendGrid sender verification for noreply@sentinelskiosk.com`}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <code style={{ fontSize: 18, fontWeight: 700, background: '#fff', padding: '6px 14px', borderRadius: 8, border: '1px solid #A7F3D0' }}>{tempPw.password}</code>
            <button onClick={() => navigator.clipboard.writeText(tempPw.password)} style={{ padding: '8px 12px', borderRadius: 8, background: '#059669', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Copy</button>
            <button onClick={() => setTempPw(null)} style={{ padding: '8px 12px', borderRadius: 8, background: 'transparent', border: 'none', color: '#047857', fontSize: 12, cursor: 'pointer' }}>Dismiss</button>
          </div>
          <div style={{ fontSize: 12, color: '#047857', marginTop: 8 }}>Shown once — share it with the user and ask them to change it after logging in.</div>
        </div>
      )}

      {/* Role legend */}
      <div style={{ background: '#F0FDFA', border: '1px solid #99F6E4', borderRadius: 16, padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: '#0F766E', fontSize: 14, marginBottom: 8 }}>
          <Info size={16} /> What each role can do
        </div>
        {ROLE_INFO.map(r => (
          <div key={r.role} style={{ fontSize: 13, color: '#134E4A', marginBottom: 4, lineHeight: 1.5 }}>
            <strong>{r.label}:</strong> {r.text}
          </div>
        ))}
      </div>

      {/* Members */}
      <div style={{ background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 2px 10px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0' }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Users size={20} color="#0D7377" /> Team Members <span style={{ fontSize: 13, color: '#94A3B8', fontWeight: 500 }}>({team.length})</span>
        </h3>

        {team.map(u => (
          <div key={u.id} style={{ padding: '14px 16px', background: '#F8FAFC', borderRadius: 12, marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {u.first_name} {u.last_name}
                  {!u.is_active && <span style={{ fontSize: 11, color: '#991B1B', fontWeight: 600 }}>· inactive</span>}
                  {u.id === user?.id && <span style={{ fontSize: 11, color: '#64748B', fontWeight: 500 }}>(you)</span>}
                </div>
                <div style={{ fontSize: 12, color: '#64748B' }}>{u.email}</div>
                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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
                  {/* Role picker — built-in roles + your custom roles; own role locked */}
                  <select
                    value={u.role_id ? `custom:${u.role_id}` : u.role}
                    disabled={u.id === user?.id || (u.role === 'super_admin' && !isSuper)}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val.startsWith('custom:')) {
                        const roleId = val.slice(7);
                        if (roleId !== u.role_id) {
                          const r = roles.find(x => x.id === roleId);
                          setConfirm({ action: 'customRole', userId: u.id, user: u, roleId, roleName: r?.name || 'custom' });
                        }
                      } else if (val !== u.role || u.role_id) {
                        setConfirm({ action: 'role', userId: u.id, user: u, role: val });
                      }
                    }}
                    title={u.id === user?.id ? 'You cannot change your own role' : 'Change role'}
                    style={{
                      fontSize: 12, fontWeight: 600, padding: '4px 8px', borderRadius: 8,
                      border: '1px solid #E2E8F0', background: '#fff', color: '#334155',
                      cursor: (u.id === user?.id || (u.role === 'super_admin' && !isSuper)) ? 'not-allowed' : 'pointer'
                    }}
                  >
                    <option value="receptionist">Receptionist</option>
                    <option value="admin">Admin</option>
                    {(isSuper || u.role === 'super_admin') && <option value="super_admin">Super Admin</option>}
                    {roles.length > 0 && (
                      <optgroup label="Custom roles">
                        {roles.map(r => (
                          <option key={r.id} value={`custom:${r.id}`}>{r.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  {u.custom_role_name && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#F0FDFA', color: '#0F766E', border: '1px solid #99F6E4' }}>
                      <KeyRound size={11} /> {u.custom_role_name}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => setConfirm({ action: 'resetPw', userId: u.id, user: u })}
                  style={{ padding: '8px 14px', borderRadius: 8, background: '#FEF3C7', border: 'none', color: '#92400E', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Reset Password
                </button>

                {u.mfa_enabled ? (
                  <button onClick={() => setConfirm({ action: 'mfaReset', userId: u.id, user: u })} title="Use when this person loses access to their authenticator"
                    style={{ padding: '8px 14px', borderRadius: 8, background: '#E0E7FF', border: 'none', color: '#3730A3', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    Reset MFA
                  </button>
                ) : (
                  <button onClick={() => setConfirm({ action: 'mfaRequire', userId: u.id, user: u })} title={u.mfa_required ? 'Remove the MFA requirement' : 'Force this person to set up MFA at next sign-in'}
                    style={{ padding: '8px 14px', borderRadius: 8, background: u.mfa_required ? '#F1F5F9' : '#E0E7FF', border: 'none', color: u.mfa_required ? '#64748B' : '#3730A3', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    {u.mfa_required ? 'Unrequire MFA' : 'Require MFA'}
                  </button>
                )}

                {u.id !== user?.id && (
                  <button onClick={() => setConfirm({ action: 'toggleActive', userId: u.id, user: u })}
                    style={{ padding: '8px 14px', borderRadius: 8, background: u.is_active ? '#FEF2F2' : '#DCFCE7', border: 'none', color: u.is_active ? '#991B1B' : '#166534', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    {u.is_active ? 'Deactivate' : 'Reactivate'}
                  </button>
                )}
              </div>
            </div>

            {/* Inline confirm bar — replaces all browser popups */}
            {confirm && confirm.userId === u.id && confirm.action !== 'deleteRole' && (
              <div style={{
                marginTop: 12, padding: '12px 14px', borderRadius: 10,
                background: '#FFFBEB', border: '1px solid #FDE68A',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap'
              }}>
                <div style={{ fontSize: 13, color: '#92400E', lineHeight: 1.5, flex: 1, minWidth: 240 }}>{confirmText()}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setConfirm(null)} disabled={busy}
                    style={{ padding: '8px 14px', borderRadius: 8, background: '#fff', border: '1px solid #E2E8F0', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    Cancel
                  </button>
                  <button onClick={runConfirmed} disabled={busy}
                    style={{ padding: '8px 16px', borderRadius: 8, background: '#D97706', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    {busy ? 'Working…' : 'Confirm'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Custom Roles — build your own roles by picking exactly which functions they unlock */}
      <div style={{ background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 2px 10px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0', marginTop: 20 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
          <KeyRound size={20} color="#0D7377" /> Custom Roles <span style={{ fontSize: 13, color: '#94A3B8', fontWeight: 500 }}>({roles.length})</span>
        </h3>
        <p style={{ fontSize: 13, color: '#64748B', marginBottom: 16, lineHeight: 1.5 }}>
          Create roles like "Security Guard" or "Office Manager" with exactly the functions they need — nothing more.
          Then assign them from each member's role dropdown above.
        </p>

        {rolesError && (
          <div style={{ fontSize: 13, color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
            {rolesError}
          </div>
        )}

        {/* Create a role */}
        <div style={{ background: '#F8FAFC', borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <input
              type="text" placeholder='Role name — e.g. "Security Guard"' value={roleForm.name}
              onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })}
              style={{ ...inputStyle, flex: '1 1 240px' }}
            />
            <button onClick={createRole} disabled={roleBusy}
              style={{ padding: '12px 20px', borderRadius: 10, background: roleBusy ? '#94A3B8' : '#0D7377', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
              <Plus size={15} /> {roleBusy ? 'Creating…' : 'Create Role'}
            </button>
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 8 }}>Functions this role can use:</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 }}>
            {PERMISSION_OPTIONS.map(p => (
              <label key={p.key} style={{
                display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer',
                padding: '8px 10px', borderRadius: 8,
                background: roleForm.permissions.includes(p.key) ? '#F0FDFA' : '#fff',
                border: roleForm.permissions.includes(p.key) ? '1px solid #5EEAD4' : '1px solid #E2E8F0'
              }}>
                <input type="checkbox" checked={roleForm.permissions.includes(p.key)} onChange={() => togglePerm(p.key)} />
                {p.label}
              </label>
            ))}
          </div>
        </div>

        {/* Existing roles */}
        {roles.length === 0 && !rolesError && (
          <p style={{ fontSize: 13, color: '#94A3B8' }}>No custom roles yet — create one above.</p>
        )}
        {roles.map(r => (
          <div key={r.id} style={{ padding: '12px 14px', background: '#F8FAFC', borderRadius: 10, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#0F172A' }}>{r.name}</span>
                <span style={{ fontSize: 12, color: '#64748B', marginLeft: 8 }}>{r.member_count} member{Number(r.member_count) !== 1 ? 's' : ''}</span>
              </div>
              <button
                onClick={() => setConfirm({ action: 'deleteRole', roleId: r.id, roleName: r.name })}
                disabled={r.member_count > 0}
                title={r.member_count > 0 ? 'Reassign members before deleting' : 'Delete role'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 8,
                  background: r.member_count > 0 ? '#F1F5F9' : '#FEF2F2', border: 'none',
                  color: r.member_count > 0 ? '#94A3B8' : '#991B1B', fontSize: 12, fontWeight: 600,
                  cursor: r.member_count > 0 ? 'not-allowed' : 'pointer'
                }}>
                <Trash2 size={13} /> Delete
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {(r.permissions || []).map(p => (
                <span key={p} style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 12, background: '#E0F2F1', color: '#0F766E' }}>
                  {PERMISSION_OPTIONS.find(o => o.key === p)?.label || p}
                </span>
              ))}
            </div>
            {confirm?.action === 'deleteRole' && confirm.roleId === r.id && (
              <div style={{
                marginTop: 10, padding: '10px 12px', borderRadius: 8,
                background: '#FFFBEB', border: '1px solid #FDE68A',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap'
              }}>
                <div style={{ fontSize: 12, color: '#92400E', flex: 1, minWidth: 200 }}>{confirmText()}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setConfirm(null)} disabled={busy}
                    style={{ padding: '6px 12px', borderRadius: 6, background: '#fff', border: '1px solid #E2E8F0', fontSize: 12, cursor: 'pointer' }}>
                    Cancel
                  </button>
                  <button onClick={runConfirmed} disabled={busy}
                    style={{ padding: '6px 14px', borderRadius: 6, background: '#D97706', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    {busy ? 'Working…' : 'Confirm'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
