import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../utils/store';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { toast } from '../utils/toast';
import {
  Building2, Users, CreditCard, TrendingUp, DollarSign,
  Shield, Activity, ArrowUpRight, ArrowDownRight, Search,
  Eye, Edit, X, Copy, Check, Monitor, Wrench, Mail
} from 'lucide-react';

const PLANS = {
  free: { label: 'Free', price: 0, color: '#94A3B8', perks: 'Up to 5 users · 100 visits/mo' },
  pro: { label: 'Pro', price: 49, color: '#0D7377', perks: 'More users, more visits' },
  enterprise: { label: 'Enterprise', price: 149, color: '#FF6B35', perks: 'Unlimited · dedicated support' },
};

export default function SuperAdmin() {
  const user = useStore((s) => s.user);
  const navigate = useNavigate();
  const tableRef = useRef(null);
  const [orgs, setOrgs] = useState([]);
  const [stats, setStats] = useState({
    total_orgs: 0, total_users: 0, total_visits: 0,
    active_visits: 0, revenue: 0
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('all');

  // Modals / panels
  const [viewOrg, setViewOrg] = useState(null);
  const [editOrg, setEditOrg] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [copied, setCopied] = useState(false);
  const [viewOrgUsers, setViewOrgUsers] = useState([]);
  const [viewOrgHosts, setViewOrgHosts] = useState([]);
  const [viewOrgUsage, setViewOrgUsage] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [tempPassword, setTempPassword] = useState(null);
  const [showPlans, setShowPlans] = useState(false);
  const [statModal, setStatModal] = useState(null); // 'users' | 'visits'
  const [statModalData, setStatModalData] = useState([]);
  const [confirmSuspend, setConfirmSuspend] = useState(null);
  const [changeEmail, setChangeEmail] = useState(null); // { user, value }
  const [supportForm, setSupportForm] = useState({ email: '', first_name: 'Sentinels', last_name: 'Support' });
  const [showSupport, setShowSupport] = useState(false);

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
      setOrgs(orgsRes.data.map(o => ({ ...o, mrr: PLANS[o.plan]?.price ?? 0 })));
      setStats(statsRes.data);
    } catch (err) {
      console.error('Failed to fetch super admin data:', err);
      toast('Failed to load organizations', 'error');
    } finally {
      setLoading(false);
    }
  };

  const openView = async (org) => {
    setViewOrg(org);
    setTempPassword(null);
    setViewOrgUsers([]);
    setViewOrgHosts([]);
    setViewOrgUsage(null);
    setShowSupport(false);
    setLoadingDetail(true);
    try {
      const res = await api.get(`/super-admin/organizations/${org.id}`);
      setViewOrg(res.data.organization);
      setViewOrgUsers(res.data.users || []);
      setViewOrgHosts(res.data.hosts || []);
      setViewOrgUsage(res.data.usage || null);
    } catch (err) {
      toast('Failed to load organization details', 'error');
    } finally {
      setLoadingDetail(false);
    }
  };

  const resetPassword = async (u) => {
    try {
      const res = await api.post(`/super-admin/users/${u.id}/reset-password`);
      setTempPassword({ email: res.data.user_email, password: res.data.temp_password });
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to reset password', 'error');
    }
  };

  const saveEmailChange = async () => {
    try {
      await api.post(`/super-admin/users/${changeEmail.user.id}/change-email`, { email: changeEmail.value });
      toast(`Email changed to ${changeEmail.value}`);
      setChangeEmail(null);
      openView(viewOrg);
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to change email', 'error');
    }
  };

  const createSupportAdmin = async () => {
    if (!supportForm.email.trim()) return toast('Enter an email for the support account', 'error');
    try {
      const res = await api.post(`/super-admin/organizations/${viewOrg.id}/support-admin`, supportForm);
      setTempPassword({ email: res.data.user.email, password: res.data.temp_password });
      setSupportForm({ email: '', first_name: 'Sentinels', last_name: 'Support' });
      setShowSupport(false);
      openView(viewOrg);
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to create support admin', 'error');
    }
  };

  const openStatModal = async (kind) => {
    setStatModal(kind);
    setStatModalData([]);
    try {
      const r = kind === 'users'
        ? await api.get('/super-admin/all-users')
        : await api.get('/super-admin/recent-visits');
      setStatModalData(r.data);
    } catch (err) {
      toast('Failed to load details', 'error');
    }
  };

  const filteredOrgs = orgs.filter(o => {
    const matchesSearch = o.name.toLowerCase().includes(search.toLowerCase()) ||
                         (o.billing_email || '').toLowerCase().includes(search.toLowerCase());
    const matchesPlan = planFilter === 'all' || o.plan === planFilter;
    return matchesSearch && matchesPlan;
  });

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
      toast(err.response?.data?.error || 'Failed to update organization', 'error');
    }
  };

  const toggleOrgStatus = async (org) => {
    const newStatus = org.status === 'suspended' ? 'active' : 'suspended';
    try {
      await api.patch(`/super-admin/organizations/${org.id}`, { status: newStatus });
      setConfirmSuspend(null);
      fetchData();
    } catch (err) {
      toast('Failed to update organization status', 'error');
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading...</div>;

  const planCounts = { free: 0, pro: 0, enterprise: 0 };
  orgs.forEach(o => { planCounts[o.plan] = (planCounts[o.plan] || 0) + 1; });

  const statCards = [
    { title: 'Organizations', value: stats.total_orgs, icon: Building2, color: '#0D7377', trend: '+2', onClick: () => tableRef.current?.scrollIntoView({ behavior: 'smooth' }), hint: 'Click to view list' },
    { title: 'Total Users', value: stats.total_users, icon: Users, color: '#FF6B35', trend: '+5', onClick: () => openStatModal('users'), hint: 'Click to verify' },
    { title: 'Monthly Visits', value: stats.total_visits, icon: Activity, color: '#9B59B6', trend: '+23%', onClick: () => openStatModal('visits'), hint: 'Click to verify' },
    { title: 'Active Now', value: stats.active_visits, icon: TrendingUp, color: '#2ECC71', trend: '0', onClick: () => openStatModal('visits'), hint: 'Click to verify' },
    { title: 'MRR', value: `$${stats.revenue}`, icon: DollarSign, color: '#0D7377', trend: '+$49', onClick: () => setShowPlans(!showPlans), hint: 'Click for plans' },
  ];

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

      {/* Stats — every card is clickable and drills into its number */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 20, marginBottom: 12 }}>
        {statCards.map((card, i) => (
          <div key={i} onClick={card.onClick} title={card.hint} style={{
            background: '#fff', borderRadius: 20, padding: 24, cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0',
            transition: 'transform 0.1s ease',
          }}
            onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'none'}>
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
            <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>{card.hint}</div>
          </div>
        ))}
      </div>

      {/* Plans panel (MRR click) — available plans + who is on what */}
      {showPlans && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 24 }}>
          {Object.entries(PLANS).map(([key, p]) => (
            <div key={key} style={{ background: '#fff', borderRadius: 16, padding: 20, border: `2px solid ${p.color}30`, boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontWeight: 800, color: p.color, fontSize: 16 }}>{p.label}</span>
                <span style={{ fontWeight: 800, color: '#0F172A' }}>${p.price}/mo</span>
              </div>
              <div style={{ fontSize: 12, color: '#64748B', marginBottom: 8 }}>{p.perks}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>
                {planCounts[key] || 0} org{(planCounts[key] || 0) !== 1 ? 's' : ''} · ${(planCounts[key] || 0) * p.price}/mo
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{
        display: 'flex', gap: 12, marginBottom: 24, marginTop: 20,
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
      <div ref={tableRef} style={{
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
                  <span style={{ fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 20, background: `${PLANS[org.plan]?.color}15`, color: PLANS[org.plan]?.color }}>
                    {PLANS[org.plan]?.label} (${PLANS[org.plan]?.price}/mo)
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
                  {confirmSuspend?.id === org.id ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: '#92400E', fontWeight: 600 }}>{org.status === 'suspended' ? 'Reactivate?' : 'Suspend?'}</span>
                      <button onClick={() => toggleOrgStatus(org)} style={{ padding: '8px 12px', borderRadius: 8, background: '#DC2626', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Confirm</button>
                      <button onClick={() => setConfirmSuspend(null)} style={{ padding: '8px 12px', borderRadius: 8, background: '#F1F5F9', border: 'none', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => openView(org)} style={{ padding: 8, borderRadius: 8, background: '#F1F5F9', border: 'none', cursor: 'pointer' }} title="Manage">
                        <Eye size={16} color="#64748B" />
                      </button>
                      <button onClick={() => openEdit(org)} style={{ padding: 8, borderRadius: 8, background: '#F1F5F9', border: 'none', cursor: 'pointer' }} title="Edit">
                        <Edit size={16} color="#64748B" />
                      </button>
                      <button onClick={() => setConfirmSuspend(org)} style={{ padding: '8px 12px', borderRadius: 8, background: org.status === 'suspended' ? '#DCFCE7' : '#FEF3C7', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: org.status === 'suspended' ? '#166534' : '#92400E' }} title={org.status === 'suspended' ? 'Reactivate' : 'Suspend'}>
                        {org.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                      </button>
                    </div>
                  )}
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

      {/* STAT DETAIL MODAL (users / visits verification) */}
      {statModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 720, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 25px 80px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700 }}>{statModal === 'users' ? `All Users (${statModalData.length})` : `Recent Visits (${statModalData.length})`}</h2>
              <button onClick={() => setStatModal(null)} style={{ padding: 8, borderRadius: 8, background: '#F1F5F9', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            {statModalData.length === 0 ? <p style={{ color: '#64748B' }}>Loading…</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC' }}>
                    {(statModal === 'users' ? ['Name', 'Email', 'Role', 'Organization', 'Status'] : ['Visitor', 'Badge', 'Organization', 'Checked In', 'Status']).map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#64748B' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {statModal === 'users' ? statModalData.map(u => (
                    <tr key={u.id} style={{ borderTop: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600 }}>{u.first_name} {u.last_name}</td>
                      <td style={{ padding: '10px 14px', fontSize: 13, color: '#64748B' }}>{u.email}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12 }}>{u.role}</td>
                      <td style={{ padding: '10px 14px', fontSize: 13 }}>{u.org_name}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: u.is_active ? '#166534' : '#991B1B' }}>{u.is_active ? 'active' : 'inactive'}</td>
                    </tr>
                  )) : statModalData.map(v => (
                    <tr key={v.id} style={{ borderTop: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600 }}>{v.visitor_first_name} {v.visitor_last_name}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12, fontFamily: 'monospace' }}>{v.badge_number}</td>
                      <td style={{ padding: '10px 14px', fontSize: 13 }}>{v.org_name}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: '#64748B' }}>{new Date(v.checked_in_at).toLocaleString()}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: v.status === 'checked_in' ? '#166534' : '#64748B' }}>{v.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* MANAGE ORGANIZATION MODAL */}
      {viewOrg && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16
        }}>
          <div style={{
            background: '#fff', borderRadius: 20, padding: 32, width: '100%', maxWidth: 680,
            maxHeight: '90vh', overflow: 'auto', boxShadow: '0 25px 80px rgba(0,0,0,0.3)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: 22, fontWeight: 700 }}>{viewOrg.name}</h2>
              <button onClick={() => setViewOrg(null)} style={{ padding: 8, borderRadius: 8, background: '#F1F5F9', border: 'none', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            {/* Usage — how they're actually using the product */}
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Activity size={16} color="#0D7377" /> Usage
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, marginBottom: 24 }}>
              {[
                ['Total visits', viewOrgUsage?.total_visits],
                ['On site now', viewOrgUsage?.active_visits],
                ['This month', viewOrgUsage?.visits_this_month],
                ['Pre-registered', viewOrgUsage?.pre_regs],
                ['Kiosk devices', viewOrgUsage?.devices],
                ['Hosts', viewOrgHosts.length],
              ].map(([label, val]) => (
                <div key={label} style={{ padding: '12px 14px', background: '#F0FDFA', borderRadius: 10, textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#0D7377' }}>{val ?? '—'}</div>
                  <div style={{ fontSize: 11, color: '#64748B' }}>{label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
              {[
                { label: 'Organization ID', value: viewOrg.id },
                { label: 'Plan', value: `${PLANS[viewOrg.plan]?.label} ($${PLANS[viewOrg.plan]?.price}/mo)` },
                { label: 'Status', value: viewOrg.status },
                { label: 'Billing Email', value: viewOrg.billing_email },
                { label: 'Max Users', value: viewOrg.max_users ?? 'N/A' },
                { label: 'Max Visits/Month', value: viewOrg.max_visits_per_month ?? 'N/A' },
              ].map((item, i) => (
                <div key={i} style={{ padding: '10px 14px', background: '#F8FAFC', borderRadius: 10 }}>
                  <div style={{ fontSize: 11, color: '#64748B', marginBottom: 2 }}>{item.label}</div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#0F172A', wordBreak: 'break-all' }}>{item.value}</div>
                </div>
              ))}
            </div>

            {/* Users */}
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Users size={16} color="#0D7377" /> Users ({viewOrgUsers.length})
            </h3>
            {loadingDetail ? (
              <p style={{ color: '#64748B', fontSize: 14, marginBottom: 24 }}>Loading users...</p>
            ) : (
              <div style={{ marginBottom: 24 }}>
                {viewOrgUsers.map(u => (
                  <div key={u.id} style={{ padding: '10px 14px', background: '#F8FAFC', borderRadius: 10, marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, color: '#0F172A' }}>
                          {u.first_name} {u.last_name} <span style={{ fontSize: 11, color: '#64748B', fontWeight: 400 }}>({u.role}{!u.is_active ? ' · inactive' : ''})</span>
                        </div>
                        <div style={{ fontSize: 12, color: '#64748B' }}>{u.email}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setChangeEmail({ user: u, value: u.email })} title="Change their login email (e.g. admin left the company)"
                          style={{ padding: '7px 12px', borderRadius: 8, background: '#E0E7FF', border: 'none', color: '#3730A3', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Mail size={12} /> Email
                        </button>
                        <button onClick={() => resetPassword(u)}
                          style={{ padding: '7px 12px', borderRadius: 8, background: '#FEF3C7', border: 'none', color: '#92400E', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          Reset Password
                        </button>
                      </div>
                    </div>
                    {changeEmail?.user.id === u.id && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <input type="email" value={changeEmail.value} onChange={(e) => setChangeEmail({ ...changeEmail, value: e.target.value })}
                          style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '2px solid #E2E8F0', fontSize: 13 }} />
                        <button onClick={saveEmailChange} style={{ padding: '10px 14px', borderRadius: 8, background: '#0D7377', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Save</button>
                        <button onClick={() => setChangeEmail(null)} style={{ padding: '10px 14px', borderRadius: 8, background: '#F1F5F9', border: 'none', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                      </div>
                    )}
                  </div>
                ))}
                {viewOrgUsers.length === 0 && <p style={{ color: '#64748B', fontSize: 14 }}>No users in this organization.</p>}
              </div>
            )}

            {/* Hosts */}
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 10 }}>Hosts ({viewOrgHosts.length})</h3>
            <div style={{ marginBottom: 24, maxHeight: 180, overflowY: 'auto' }}>
              {viewOrgHosts.map(h => (
                <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 14px', background: '#F8FAFC', borderRadius: 8, marginBottom: 6, fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>{h.first_name} {h.last_name}{!h.is_active ? ' (inactive)' : ''}</span>
                  <span style={{ color: '#64748B' }}>{h.department || h.email}</span>
                </div>
              ))}
              {viewOrgHosts.length === 0 && !loadingDetail && <p style={{ color: '#64748B', fontSize: 14 }}>No hosts yet.</p>}
            </div>

            {/* Support admin */}
            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 12, padding: 16, marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#92400E', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Wrench size={16} /> Tech Support Access
                </div>
                <button onClick={() => setShowSupport(!showSupport)}
                  style={{ padding: '8px 14px', borderRadius: 8, background: '#D97706', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  {showSupport ? 'Cancel' : 'Create Support Admin'}
                </button>
              </div>
              <div style={{ fontSize: 12, color: '#92400E', marginTop: 6 }}>
                Creates an admin login inside this organization so Sentinels staff can troubleshoot for them (enterprise-tier feature).
              </div>
              {showSupport && (
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <input type="email" placeholder="support email (yours)" value={supportForm.email}
                    onChange={(e) => setSupportForm({ ...supportForm, email: e.target.value })}
                    style={{ flex: 1, minWidth: 200, padding: '10px 12px', borderRadius: 8, border: '2px solid #E2E8F0', fontSize: 13 }} />
                  <button onClick={createSupportAdmin}
                    style={{ padding: '10px 16px', borderRadius: 8, background: '#0D7377', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    Create
                  </button>
                </div>
              )}
            </div>

            {/* Temp password display */}
            {tempPassword && (
              <div style={{ padding: 16, background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 12, marginBottom: 24 }}>
                <div style={{ fontWeight: 700, color: '#065F46', marginBottom: 8, fontSize: 14 }}>Temporary password for {tempPassword.email}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <code style={{ fontSize: 18, fontWeight: 700, background: '#fff', padding: '6px 14px', borderRadius: 8, border: '1px solid #A7F3D0' }}>{tempPassword.password}</code>
                  <button onClick={() => navigator.clipboard.writeText(tempPassword.password)} style={{ padding: '8px 12px', borderRadius: 8, background: '#059669', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Copy</button>
                  <button onClick={() => setTempPassword(null)} style={{ padding: '8px 12px', borderRadius: 8, background: 'transparent', border: 'none', color: '#047857', fontSize: 12, cursor: 'pointer' }}>Dismiss</button>
                </div>
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
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 8 }}>Billing Email</label>
                <input type="email" value={editForm.billing_email || ''} onChange={(e) => setEditForm({...editForm, billing_email: e.target.value})}
                  style={{ width: '100%', padding: '12px 16px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14, outline: 'none' }} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 8 }}>Plan</label>
                  <select value={editForm.plan || 'free'} onChange={(e) => setEditForm({...editForm, plan: e.target.value})}
                    style={{ width: '100%', padding: '12px 16px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14, background: '#fff' }}>
                    <option value="free">Free ($0/mo)</option>
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
