import React, { useState, useEffect } from 'react';
import { useStore } from '../utils/store';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import {
  Building2, Users, CreditCard, TrendingUp, DollarSign,
  Shield, Activity, ArrowUpRight, ArrowDownRight, Search,
  Filter, Eye, Edit, Trash2, X, Copy, Check, ExternalLink
} from 'lucide-react';

export default function SuperAdmin() {
  const user = useStore((s) => s.user);
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState([]);
  const [stats, setStats] = useState({
    total_orgs: 0, total_users: 0, total_visits: 0,
    active_visits: 0, revenue: 0
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('all');

  // Modals
  const [viewOrg, setViewOrg] = useState(null);
  const [editOrg, setEditOrg] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [copied, setCopied] = useState(false);
  const [viewOrgUsers, setViewOrgUsers] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [tempPassword, setTempPassword] = useState(null);

  useEffect(() => {
    if (user?.role !== 'super_admin') {
      navigate('/');
    }
  }, [user, navigate]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [orgsRes, statsRes] = await Promise.all([
        api.get('/super-admin/organizations'),
        api.get('/super-admin/stats')
      ]);
      const planMrr = { free: 0, pro: 49, enterprise: 149 };
      setOrgs(orgsRes.data.map(o => ({ ...o, mrr: planMrr[o.plan] ?? 0 })));
      setStats(statsRes.data);
    } catch (err) {
      console.error('Failed to fetch super admin data:', err);
      alert('Failed to load organizations');
    } finally {
      setLoading(false);
    }
  };

  const openView = async (org) => {
    setViewOrg(org);
    setTempPassword(null);
    setViewOrgUsers([]);
    setLoadingDetail(true);
    try {
      const res = await api.get(`/super-admin/organizations/${org.id}`);
      setViewOrg(res.data.organization);
      setViewOrgUsers(res.data.users);
    } catch (err) {
      alert('Failed to load organization details');
    } finally {
      setLoadingDetail(false);
    }
  };

  const resetPassword = async (u) => {
    if (!window.confirm(`Reset password for ${u.first_name} ${u.last_name} (${u.email})?`)) return;
    try {
      const res = await api.post(`/super-admin/users/${u.id}/reset-password`);
      setTempPassword({ email: res.data.user_email, password: res.data.temp_password });
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to reset password');
    }
  };

  const filteredOrgs = orgs.filter(o => {
    const matchesSearch = o.name.toLowerCase().includes(search.toLowerCase()) ||
                         o.billing_email.toLowerCase().includes(search.toLowerCase());
    const matchesPlan = planFilter === 'all' || o.plan === planFilter;
    return matchesSearch && matchesPlan;
  });

  const planColors = { free: '#94A3B8', pro: '#0D7377', enterprise: '#FF6B35' };
  const planLabels = { free: 'Free', pro: 'Pro ($49/mo)', enterprise: 'Enterprise ($149/mo)' };

  const copyKioskUrl = (url) => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openEdit = (org) => {
    setEditOrg(org);
    setEditForm({ ...org });
  };

  const saveEdit = async () => {
    try {
      await api.patch(`/super-admin/organizations/${editOrg.id}`, editForm);
      setEditOrg(null);
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update organization');
    }
  };

  const toggleOrgStatus = async (org) => {
    const newStatus = org.status === 'suspended' ? 'active' : 'suspended';
    if (!window.confirm(`${newStatus === 'suspended' ? 'Suspend' : 'Reactivate'} ${org.name}?`)) return;
    try {
      await api.patch(`/super-admin/organizations/${org.id}`, { status: newStatus });
      fetchData();
    } catch (err) {
      alert('Failed to update organization status');
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading...</div>;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 800, color: '#0F172A', marginBottom: 4 }}>Super Admin</h1>
          <p style={{ color: '#64748B', fontSize: 15 }}>Manage all organizations and subscriptions</p>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 16px', borderRadius: 10,
          background: '#FEF3C7', color: '#92400E', fontSize: 14, fontWeight: 600
        }}>
          <Shield size={16} /> Super Admin Access
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 20, marginBottom: 32 }}>
        {[
          { title: 'Organizations', value: stats.total_orgs, icon: Building2, color: '#0D7377', trend: '+2' },
          { title: 'Total Users', value: stats.total_users, icon: Users, color: '#FF6B35', trend: '+5' },
          { title: 'Monthly Visits', value: stats.total_visits, icon: Activity, color: '#9B59B6', trend: '+23%' },
          { title: 'Active Now', value: stats.active_visits, icon: TrendingUp, color: '#2ECC71', trend: '0' },
          { title: 'MRR', value: `$${stats.revenue}`, icon: DollarSign, color: '#0D7377', trend: '+$49' },
        ].map((card, i) => (
          <div key={i} style={{
            background: '#fff', borderRadius: 20, padding: 24,
            boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 14,
                background: `${card.color}15`, display: 'flex',
                alignItems: 'center', justifyContent: 'center'
              }}>
                <card.icon size={24} color={card.color} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: card.trend.startsWith('+') ? '#2ECC71' : '#64748B' }}>
                {card.trend.startsWith('+') ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                {card.trend}
              </span>
            </div>
            <div style={{ fontSize: 32, fontWeight: 800, color: '#0F172A', marginBottom: 4 }}>{card.value}</div>
            <div style={{ fontSize: 14, color: '#64748B' }}>{card.title}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex', gap: 12, marginBottom: 24,
        background: '#fff', padding: '16px 20px', borderRadius: 16,
        boxShadow: '0 2px 10px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0'
      }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
          <input type="text" placeholder="Search organizations..." value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', padding: '12px 16px 12px 44px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14, outline: 'none' }} />
        </div>
        <select value={planFilter} onChange={(e) => setPlanFilter(e.target.value)}
          style={{ padding: '12px 16px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14, background: '#fff' }}>
          <option value="all">All Plans</option>
          <option value="free">Free</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
        </select>
      </div>

      {/* Organizations Table */}
      <div style={{
        background: '#fff', borderRadius: 20, overflowX: 'auto',
        boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#F8FAFC' }}>
              {['Organization', 'Plan', 'Users', 'Visits', 'MRR', 'Status', 'Actions'].map(h => (
                <th key={h} style={{ padding: '16px 20px', textAlign: 'left', fontSize: 13, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredOrgs.map(org => (
              <tr key={org.id} style={{ borderTop: '1px solid #E2E8F0' }}>
                <td style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: '50%',
                      background: 'linear-gradient(135deg, #0D7377, #14FFEC)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 14, color: '#fff'
                    }}>{org.name[0]}</div>
                    <div>
                      <div style={{ fontWeight: 600, color: '#0F172A', fontSize: 14 }}>{org.name}</div>
                      <div style={{ fontSize: 12, color: '#64748B' }}>{org.billing_email}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '16px 20px' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 20, background: `${planColors[org.plan]}15`, color: planColors[org.plan] }}>
                    {planLabels[org.plan]}
                  </span>
                </td>
                <td style={{ padding: '16px 20px', fontSize: 14, color: '#334155' }}>{org.users_count}</td>
                <td style={{ padding: '16px 20px', fontSize: 14, color: '#334155' }}>{org.visits_this_month}</td>
                <td style={{ padding: '16px 20px', fontSize: 14, fontWeight: 600, color: '#0F172A' }}>${org.mrr}/mo</td>
                <td style={{ padding: '16px 20px' }}>
                  <span style={{
                    fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 20,
                    background: org.status === 'active' ? '#DCFCE7' : org.status === 'suspended' ? '#FEF3C7' : '#FEF2F2',
                    color: org.status === 'active' ? '#166534' : org.status === 'suspended' ? '#92400E' : '#991B1B'
                  }}>{org.status}</span>
                </td>
                <td style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => openView(org)} style={{ padding: 8, borderRadius: 8, background: '#F1F5F9', border: 'none', cursor: 'pointer' }} title="View Details">
                      <Eye size={16} color="#64748B" />
                    </button>
                    <button onClick={() => openEdit(org)} style={{ padding: 8, borderRadius: 8, background: '#F1F5F9', border: 'none', cursor: 'pointer' }} title="Edit">
                      <Edit size={16} color="#64748B" />
                    </button>
                    <button onClick={() => toggleOrgStatus(org)} style={{ padding: '8px 12px', borderRadius: 8, background: org.status === 'suspended' ? '#DCFCE7' : '#FEF3C7', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: org.status === 'suspended' ? '#166534' : '#92400E' }} title={org.status === 'suspended' ? 'Reactivate' : 'Suspend'}>
                      {org.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Kiosk URL Generator */}
      <div style={{
        background: '#fff', borderRadius: 20, padding: 24, marginTop: 24,
        boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0'
      }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 16 }}>Kiosk URL Generator</h3>
        <p style={{ color: '#64748B', fontSize: 14, marginBottom: 16 }}>Share this URL with each organization for their kiosk:</p>
        {filteredOrgs.map(org => {
          const url = `https://www.sentinelskiosk.com/kiosk?org=${org.id}`;
          return (
            <div key={org.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px', background: '#F8FAFC', borderRadius: 10, marginBottom: 8
            }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{org.name}</span>
                <span style={{ color: '#64748B', fontSize: 12, marginLeft: 8 }}>{org.plan}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code style={{ fontSize: 12, background: '#E2E8F0', padding: '4px 8px', borderRadius: 6, fontFamily: 'monospace' }}>{url}</code>
                <button onClick={() => copyKioskUrl(url)} style={{ padding: '6px 12px', borderRadius: 6, background: '#0D7377', border: 'none', color: '#fff', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* VIEW ORGANIZATION MODAL */}
      {viewOrg && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }}>
          <div style={{
            background: '#fff', borderRadius: 20, padding: 32, width: '100%', maxWidth: 600,
            maxHeight: '90vh', overflow: 'auto', boxShadow: '0 25px 80px rgba(0,0,0,0.3)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: 22, fontWeight: 700 }}>{viewOrg.name}</h2>
              <button onClick={() => setViewOrg(null)} style={{ padding: 8, borderRadius: 8, background: '#F1F5F9', border: 'none', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
              {[
                { label: 'Organization ID', value: viewOrg.id },
                { label: 'Slug', value: viewOrg.slug || 'N/A' },
                { label: 'Plan', value: planLabels[viewOrg.plan] },
                { label: 'Status', value: viewOrg.status },
                { label: 'Billing Email', value: viewOrg.billing_email },
                { label: 'Phone', value: viewOrg.phone || 'N/A' },
                { label: 'Address', value: viewOrg.address || 'N/A' },
                { label: 'Created', value: viewOrg.created_at ? new Date(viewOrg.created_at).toLocaleDateString() : 'N/A' },
                { label: 'Max Users', value: viewOrg.max_users ?? 'N/A' },
                { label: 'Max Visits/Month', value: viewOrg.max_visits_per_month ?? 'N/A' },
                { label: 'Trial Ends', value: viewOrg.trial_ends_at ? new Date(viewOrg.trial_ends_at).toLocaleDateString() : 'N/A' },
                { label: 'MRR', value: `$${({ free: 0, pro: 49, enterprise: 149 })[viewOrg.plan] ?? 0}/mo` },
              ].map((item, i) => (
                <div key={i} style={{ padding: '12px 16px', background: '#F8FAFC', borderRadius: 10 }}>
                  <div style={{ fontSize: 12, color: '#64748B', marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#0F172A', wordBreak: 'break-all' }}>{item.value}</div>
                </div>
              ))}
            </div>

            {/* Users in this organization */}
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 12 }}>Users ({viewOrgUsers.length})</h3>
            {loadingDetail ? (
              <p style={{ color: '#64748B', fontSize: 14, marginBottom: 24 }}>Loading users...</p>
            ) : (
              <div style={{ marginBottom: 24 }}>
                {viewOrgUsers.map(u => (
                  <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#F8FAFC', borderRadius: 10, marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: '#0F172A' }}>
                        {u.first_name} {u.last_name} <span style={{ fontSize: 11, color: '#64748B', fontWeight: 400 }}>({u.role}{!u.is_active ? ' · inactive' : ''})</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#64748B' }}>{u.email}</div>
                    </div>
                    <button onClick={() => resetPassword(u)} style={{ padding: '8px 14px', borderRadius: 8, background: '#FEF3C7', border: 'none', color: '#92400E', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      Reset Password
                    </button>
                  </div>
                ))}
                {viewOrgUsers.length === 0 && <p style={{ color: '#64748B', fontSize: 14 }}>No users in this organization.</p>}
              </div>
            )}

            {/* One-time temporary password display */}
            {tempPassword && (
              <div style={{ padding: 16, background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 12, marginBottom: 24 }}>
                <div style={{ fontWeight: 700, color: '#065F46', marginBottom: 8, fontSize: 14 }}>Temporary password for {tempPassword.email}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <code style={{ fontSize: 18, fontWeight: 700, background: '#fff', padding: '6px 14px', borderRadius: 8, border: '1px solid #A7F3D0' }}>{tempPassword.password}</code>
                  <button onClick={() => navigator.clipboard.writeText(tempPassword.password)} style={{ padding: '8px 12px', borderRadius: 8, background: '#059669', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Copy</button>
                </div>
                <div style={{ fontSize: 12, color: '#047857', marginTop: 8 }}>Shown once — share it with the user and ask them to change it after logging in.</div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => { setViewOrg(null); openEdit(viewOrg); }}
                style={{ flex: 1, padding: '14px', borderRadius: 10, background: '#0D7377', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                Edit Organization
              </button>
              <button onClick={() => setViewOrg(null)}
                style={{ flex: 1, padding: '14px', borderRadius: 10, background: '#F1F5F9', border: 'none', fontWeight: 600, cursor: 'pointer' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT ORGANIZATION MODAL */}
      {editOrg && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }}>
          <div style={{
            background: '#fff', borderRadius: 20, padding: 32, width: '100%', maxWidth: 500,
            boxShadow: '0 25px 80px rgba(0,0,0,0.3)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: 22, fontWeight: 700 }}>Edit {editOrg.name}</h2>
              <button onClick={() => setEditOrg(null)} style={{ padding: 8, borderRadius: 8, background: '#F1F5F9', border: 'none', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 8 }}>Organization Name</label>
                <input type="text" value={editForm.name || ''} onChange={(e) => setEditForm({...editForm, name: e.target.value})}
                  style={{ width: '100%', padding: '12px 16px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14, outline: 'none' }} />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 8 }}>Billing Email</label>
                <input type="email" value={editForm.billing_email || ''} onChange={(e) => setEditForm({...editForm, billing_email: e.target.value})}
                  style={{ width: '100%', padding: '12px 16px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14, outline: 'none' }} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 8 }}>Plan</label>
                  <select value={editForm.plan || 'free'} onChange={(e) => setEditForm({...editForm, plan: e.target.value})}
                    style={{ width: '100%', padding: '12px 16px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14, background: '#fff' }}>
                    <option value="free">Free</option>
                    <option value="pro">Pro ($49/mo)</option>
                    <option value="enterprise">Enterprise ($149/mo)</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 8 }}>Status</label>
                  <select value={editForm.status || 'active'} onChange={(e) => setEditForm({...editForm, status: e.target.value})}
                    style={{ width: '100%', padding: '12px 16px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14, background: '#fff' }}>
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 8 }}>Max Users</label>
                  <input type="number" value={editForm.max_users || 5} onChange={(e) => setEditForm({...editForm, max_users: parseInt(e.target.value)})}
                    style={{ width: '100%', padding: '12px 16px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14, outline: 'none' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 8 }}>Max Visits/Month</label>
                  <input type="number" value={editForm.max_visits_per_month || 100} onChange={(e) => setEditForm({...editForm, max_visits_per_month: parseInt(e.target.value)})}
                    style={{ width: '100%', padding: '12px 16px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14, outline: 'none' }} />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 8 }}>Primary Color</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <input type="color" value={editForm.primary_color || '#0D7377'} onChange={(e) => setEditForm({...editForm, primary_color: e.target.value})}
                    style={{ width: 50, height: 50, border: 'none', borderRadius: 10, cursor: 'pointer' }} />
                  <span style={{ fontSize: 14, color: '#64748B', fontFamily: 'monospace' }}>{editForm.primary_color || '#0D7377'}</span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
              <button onClick={() => setEditOrg(null)}
                style={{ flex: 1, padding: '14px', borderRadius: 10, background: '#F1F5F9', border: 'none', fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={saveEdit}
                style={{ flex: 1, padding: '14px', borderRadius: 10, background: '#0D7377', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
