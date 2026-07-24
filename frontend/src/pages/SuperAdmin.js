import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../utils/store';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { toast } from '../utils/toast';
import {
  Building2, Users, CreditCard, TrendingUp, DollarSign,
  Shield, Activity, ArrowUpRight, ArrowDownRight, Search,
  Edit, X, Copy, Check, Wrench, Mail, Trash2
} from 'lucide-react';

const PLANS = {
  free: { label: 'Free', price: 0, color: '#94A3B8', perks: '5 users · 100 visits/mo · 1 device' },
  pro: { label: 'Pro', price: 49, color: '#0D7377', perks: '25 users · 2,000 visits/mo · 5 devices' },
  enterprise: { label: 'Enterprise', price: 149, color: '#FF6B35', perks: '1,000 users · 100k visits/mo · 50 devices' },
};

// Mirror of backend utils/plans.js — keep in sync
const PLAN_LIMITS = {
  free: { max_users: 5, max_visits_per_month: 100, max_devices: 1 },
  pro: { max_users: 25, max_visits_per_month: 2000, max_devices: 5 },
  enterprise: { max_users: 1000, max_visits_per_month: 100000, max_devices: 50 },
};
const FEATURE_LIST = [
  { key: 'reports', label: 'Reports & analytics' },
  { key: 'compliance', label: 'Compliance / NDA records' },
  { key: 'sms', label: 'SMS notifications' },
  { key: 'bulk_import', label: 'Bulk host import (CSV)' },
  { key: 'custom_fields', label: 'Custom registration fields' },
  { key: 'backups', label: 'Daily backups' },
];
const PLAN_FEATURES = {
  free: [],
  pro: ['reports', 'compliance', 'sms', 'bulk_import', 'custom_fields'],
  enterprise: ['reports', 'compliance', 'sms', 'bulk_import', 'custom_fields', 'backups'],
};
// Effective state of a feature = plan default, unless the org has an override
const effectiveFeature = (plan, overrides, key) =>
  overrides && key in overrides ? !!overrides[key] : PLAN_FEATURES[plan]?.includes(key) || false;

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
  // Create-organization modal (manual provisioning for offline/paid signups)
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', plan: 'pro', admin_first_name: '', admin_last_name: '', admin_email: '', billing_email: '', trial_days: 14 });
  const [createBusy, setCreateBusy] = useState(false);
  const [createdResult, setCreatedResult] = useState(null); // { organization, admin_email, temp_password }
  // Invite user into the org being managed
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({ first_name: '', last_name: '', email: '', role: 'receptionist' });
  const [inviteBusy, setInviteBusy] = useState(false);

  // Modals / panels
  const [viewOrg, setViewOrg] = useState(null);
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
  const [confirmDelete, setConfirmDelete] = useState(null); // org pending delete confirmation
  const [deleting, setDeleting] = useState(false);
  const [changeEmail, setChangeEmail] = useState(null); // { user, value }
  const [supportForm, setSupportForm] = useState({ email: '', first_name: 'Sentinels', last_name: 'Support' });
  const [showSupport, setShowSupport] = useState(false);
  // Plan & billing editing inside the manage modal
  const [planEdit, setPlanEdit] = useState({ name: '', plan: 'free', billing_email: '', max_users: '', max_visits_per_month: '', max_devices: '', plan_renews_at: '' });
  const [savingPlan, setSavingPlan] = useState(false);
  // Feature overrides for the org being managed
  const [featureOverrides, setFeatureOverrides] = useState({});
  const [savingFeatures, setSavingFeatures] = useState(false);
  // Backups panel (super admin view of the org's snapshots)
  const [orgBackups, setOrgBackups] = useState([]);
  const [backupsError, setBackupsError] = useState(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(null); // backup row
  // Tech support access: assign existing members of YOUR org to a customer org
  const [candidates, setCandidates] = useState([]);
  const [supportList, setSupportList] = useState([]);
  const [supportPick, setSupportPick] = useState('');
  const [supportError, setSupportError] = useState(null);

  useEffect(() => {
    if (user?.role !== 'super_admin') {
      navigate('/');
    }
  }, [user, navigate]);

  useEffect(() => {
    fetchData();
    // Load your own team once — these are the people you can grant support access to
    api.get('/super-admin/support-candidates')
      .then(r => setCandidates(r.data))
      .catch(() => {});
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
    setSupportList([]);
    setSupportPick('');
    setSupportError(null);
    setOrgBackups([]);
    setBackupsError(null);
    setConfirmRestore(null);
    const toEdit = (o) => ({
      name: o.name || '',
      plan: o.plan || 'free',
      billing_email: o.billing_email || '',
      max_users: o.max_users ?? '',
      max_visits_per_month: o.max_visits_per_month ?? '',
      max_devices: o.max_devices ?? '',
      plan_renews_at: o.plan_renews_at ? o.plan_renews_at.slice(0, 10) : '',
    });
    setPlanEdit(toEdit(org));
    setFeatureOverrides(org.features || {});
    setLoadingDetail(true);
    try {
      const res = await api.get(`/super-admin/organizations/${org.id}`);
      setViewOrg(res.data.organization);
      setViewOrgUsers(res.data.users || []);
      setViewOrgHosts(res.data.hosts || []);
      setViewOrgUsage(res.data.usage || null);
      setPlanEdit(toEdit(res.data.organization));
      setFeatureOverrides(res.data.organization.features || {});
      // Who from your team already has support access to this org?
      try {
        const sa = await api.get(`/super-admin/organizations/${org.id}/support-access`);
        setSupportList(sa.data);
      } catch (e) {
        setSupportError(e.response?.data?.error || null);
      }
      // This org's backup snapshots
      try {
        const bk = await api.get(`/backups/super?org_id=${org.id}`);
        setOrgBackups(bk.data);
      } catch (e) {
        setBackupsError(e.response?.data?.error || null);
      }
    } catch (err) {
      toast('Failed to load organization details', 'error');
    } finally {
      setLoadingDetail(false);
    }
  };

  const savePlanEdit = async () => {
    setSavingPlan(true);
    try {
      await api.patch(`/super-admin/organizations/${viewOrg.id}`, {
        ...planEdit,
        max_users: planEdit.max_users === '' ? null : Number(planEdit.max_users),
        max_visits_per_month: planEdit.max_visits_per_month === '' ? null : Number(planEdit.max_visits_per_month),
        max_devices: planEdit.max_devices === '' ? null : Number(planEdit.max_devices),
        plan_renews_at: planEdit.plan_renews_at || null,
      });
      toast('Plan & limits updated');
      setViewOrg({ ...viewOrg, ...planEdit });
      fetchData();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to update plan', 'error');
    } finally {
      setSavingPlan(false);
    }
  };

  // Toggle one feature: write an override (true/false) so it differs from the plan default
  const toggleFeature = (key) => {
    const current = effectiveFeature(planEdit.plan, featureOverrides, key);
    setFeatureOverrides({ ...featureOverrides, [key]: !current });
  };

  const saveFeatures = async () => {
    setSavingFeatures(true);
    try {
      await api.patch(`/super-admin/organizations/${viewOrg.id}`, { features: featureOverrides });
      toast('Feature access updated — applies to that organization immediately');
      setViewOrg({ ...viewOrg, features: featureOverrides });
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to update features', 'error');
    } finally {
      setSavingFeatures(false);
    }
  };

  const generateBackup = async () => {
    setBackupBusy(true);
    try {
      await api.post('/backups/super/generate', { org_id: viewOrg.id });
      const bk = await api.get(`/backups/super?org_id=${viewOrg.id}`);
      setOrgBackups(bk.data);
      toast('Snapshot created');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to generate snapshot', 'error');
    } finally {
      setBackupBusy(false);
    }
  };

  const downloadBackup = async (id, superPath) => {
    try {
      const r = await api.get(`/backups/${superPath ? 'super/' : ''}${id}/download`, { responseType: 'blob' });
      const dispo = r.headers['content-disposition'] || '';
      const name = (dispo.match(/filename="([^"]+)"/) || [])[1] || `backup-${id}.json`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(r.data);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      toast('Failed to download backup', 'error');
    }
  };

  const restoreBackup = async () => {
    setBackupBusy(true);
    try {
      await api.post(`/backups/super/${confirmRestore.id}/restore`);
      toast('Organization restored from snapshot — their data now matches the backup');
      setConfirmRestore(null);
      openView(viewOrg);
    } catch (err) {
      toast(err.response?.data?.error || 'Restore failed', 'error');
    } finally {
      setBackupBusy(false);
    }
  };

  const grantSupport = async () => {
    if (!supportPick) return toast('Pick a team member first', 'error');
    try {
      await api.post(`/super-admin/organizations/${viewOrg.id}/support-access`, { user_id: supportPick });
      toast('Support access granted — they now have an organization switcher in their sidebar');
      setSupportPick('');
      const sa = await api.get(`/super-admin/organizations/${viewOrg.id}/support-access`);
      setSupportList(sa.data);
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to grant support access', 'error');
    }
  };

  const revokeSupport = async (userId) => {
    try {
      await api.delete(`/super-admin/organizations/${viewOrg.id}/support-access/${userId}`);
      setSupportList(supportList.filter(s => s.user_id !== userId));
      toast('Support access revoked');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to revoke access', 'error');
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

  const deleteOrg = async (org) => {
    setDeleting(true);
    try {
      await api.delete(`/super-admin/organizations/${org.id}`);
      toast(`Organization "${org.name}" and all its data were deleted`);
      setConfirmDelete(null);
      setViewOrg(null);
      fetchData();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to delete organization', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const toggleUserStatus = async (u) => {
    try {
      await api.patch(`/super-admin/users/${u.id}/status`, { is_active: !u.is_active });
      toast(`${u.is_active ? 'Deactivated' : 'Reactivated'} ${u.email}`);
      openView(viewOrg); // refresh the modal's user list
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to update user', 'error');
    }
  };

  const createOrganization = async () => {
    if (!createForm.name.trim() || !createForm.admin_email.trim() || !createForm.admin_first_name.trim() || !createForm.admin_last_name.trim()) {
      return toast('Organization name and admin name/email are required', 'error');
    }
    setCreateBusy(true);
    try {
      const r = await api.post('/super-admin/organizations', {
        ...createForm,
        billing_email: createForm.billing_email || createForm.admin_email,
      });
      setCreatedResult(r.data);
      fetchData();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to create organization', 'error');
    } finally {
      setCreateBusy(false);
    }
  };

  const inviteUser = async () => {
    if (!inviteForm.email.trim() || !inviteForm.first_name.trim() || !inviteForm.last_name.trim()) {
      return toast('Name and email are required', 'error');
    }
    setInviteBusy(true);
    try {
      const r = await api.post(`/super-admin/organizations/${viewOrg.id}/invite`, inviteForm);
      setTempPassword({ email: r.data.email, password: r.data.temp_password });
      setInviteForm({ first_name: '', last_name: '', email: '', role: 'receptionist' });
      setShowInvite(false);
      openView(viewOrg);
      toast('User invited — credentials were emailed to them');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to invite user', 'error');
    } finally {
      setInviteBusy(false);
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
        <button
          onClick={() => { setCreatedResult(null); setCreateForm({ name: '', plan: 'pro', admin_first_name: '', admin_last_name: '', admin_email: '', billing_email: '', trial_days: 14 }); setShowCreate(true); }}
          style={{
            padding: '12px 20px', borderRadius: 12, background: '#0D7377', border: 'none',
            color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap'
          }}
        >
          + New Organization
        </button>
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
                  {org.plan === 'free' && org.trial_ends_at && (
                    <div style={{ fontSize: 11, marginTop: 4, fontWeight: 600, color: new Date(org.trial_ends_at) < new Date() ? '#991B1B' : '#B45309' }}>
                      {new Date(org.trial_ends_at) < new Date()
                        ? `Trial expired ${new Date(org.trial_ends_at).toLocaleDateString()}`
                        : `Trial ends ${new Date(org.trial_ends_at).toLocaleDateString()} (${Math.max(0, Math.ceil((new Date(org.trial_ends_at) - Date.now()) / 864e5))}d left)`}
                    </div>
                  )}
                  {org.plan !== 'free' && org.plan_renews_at && (
                    <div style={{ fontSize: 11, marginTop: 4, color: new Date(org.plan_renews_at) < new Date() ? '#991B1B' : '#64748B', fontWeight: 600 }}>
                      {new Date(org.plan_renews_at) < new Date() ? 'Renewal overdue: ' : 'Renews: '}{new Date(org.plan_renews_at).toLocaleDateString()}
                    </div>
                  )}
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
                  {confirmDelete?.id === org.id ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', maxWidth: 280 }}>
                      <span style={{ fontSize: 12, color: '#991B1B', fontWeight: 600 }}>Delete forever? All users, hosts and visit history will be lost.</span>
                      <button onClick={() => deleteOrg(org)} disabled={deleting}
                        style={{ padding: '8px 12px', borderRadius: 8, background: '#DC2626', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: deleting ? 'not-allowed' : 'pointer' }}>
                        {deleting ? 'Deleting…' : 'Yes, delete'}
                      </button>
                      <button onClick={() => setConfirmDelete(null)} style={{ padding: '8px 12px', borderRadius: 8, background: '#F1F5F9', border: 'none', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                    </div>
                  ) : confirmSuspend?.id === org.id ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: '#92400E', fontWeight: 600 }}>{org.status === 'suspended' ? 'Reactivate?' : 'Suspend?'}</span>
                      <button onClick={() => toggleOrgStatus(org)} style={{ padding: '8px 12px', borderRadius: 8, background: '#DC2626', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Confirm</button>
                      <button onClick={() => setConfirmSuspend(null)} style={{ padding: '8px 12px', borderRadius: 8, background: '#F1F5F9', border: 'none', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button onClick={() => openView(org)}
                        style={{ padding: '8px 14px', borderRadius: 8, background: '#F1F5F9', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', gap: 6 }}
                        title="Manage users, plan, billing, hosts and support access">
                        <Edit size={14} /> Manage
                      </button>
                      <button onClick={() => setConfirmSuspend(org)} style={{ padding: '8px 12px', borderRadius: 8, background: org.status === 'suspended' ? '#DCFCE7' : '#FEF3C7', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: org.status === 'suspended' ? '#166534' : '#92400E' }} title={org.status === 'suspended' ? 'Reactivate' : 'Suspend'}>
                        {org.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                      </button>
                      {org.id !== (user?.home_org_id || user?.org_id) && (
                        <button onClick={() => setConfirmDelete(org)}
                          style={{ padding: '8px 12px', borderRadius: 8, background: '#FEF2F2', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#991B1B', display: 'flex', alignItems: 'center', gap: 5 }}
                          title="Delete this organization and ALL its data — cannot be undone">
                          <Trash2 size={13} /> Delete
                        </button>
                      )}
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
        <div className="responsive-modal" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
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
        <div className="responsive-modal"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
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

            {/* Plan, limits & billing — editable */}
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <CreditCard size={16} color="#0D7377" /> Plan, Limits & Billing
            </h3>
            <div style={{ padding: 14, background: '#F8FAFC', borderRadius: 12, marginBottom: 16 }}>
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 4 }}>Organization Name</label>
                <input type="text" value={planEdit.name} onChange={(e) => setPlanEdit({ ...planEdit, name: e.target.value })}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '2px solid #E2E8F0', fontSize: 13 }} />
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
                <div style={{ flex: '1 1 130px' }}>
                  <label style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 4 }}>Plan</label>
                  <select value={planEdit.plan} onChange={(e) => setPlanEdit({ ...planEdit, plan: e.target.value })}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '2px solid #E2E8F0', fontSize: 13, background: '#fff' }}>
                    <option value="free">Free ($0/mo)</option>
                    <option value="pro">Pro ($49/mo)</option>
                    <option value="enterprise">Enterprise ($149/mo)</option>
                  </select>
                </div>
                <div style={{ flex: '1 1 110px' }}>
                  <label style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 4 }}>Max Users</label>
                  <input type="number" min="1" value={planEdit.max_users} onChange={(e) => setPlanEdit({ ...planEdit, max_users: e.target.value })}
                    placeholder={String(PLAN_LIMITS[planEdit.plan]?.max_users)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '2px solid #E2E8F0', fontSize: 13 }} />
                </div>
                <div style={{ flex: '1 1 120px' }}>
                  <label style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 4 }}>Max Visits/Mo</label>
                  <input type="number" min="1" value={planEdit.max_visits_per_month} onChange={(e) => setPlanEdit({ ...planEdit, max_visits_per_month: e.target.value })}
                    placeholder={String(PLAN_LIMITS[planEdit.plan]?.max_visits_per_month)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '2px solid #E2E8F0', fontSize: 13 }} />
                </div>
                <div style={{ flex: '1 1 100px' }}>
                  <label style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 4 }}>Max Devices</label>
                  <input type="number" min="1" value={planEdit.max_devices} onChange={(e) => setPlanEdit({ ...planEdit, max_devices: e.target.value })}
                    placeholder={String(PLAN_LIMITS[planEdit.plan]?.max_devices)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '2px solid #E2E8F0', fontSize: 13 }} />
                </div>
                <div style={{ flex: '1 1 140px' }}>
                  <label style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 4 }}>Renews On</label>
                  <input type="date" value={planEdit.plan_renews_at} onChange={(e) => setPlanEdit({ ...planEdit, plan_renews_at: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '2px solid #E2E8F0', fontSize: 13 }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ flex: '2 1 220px' }}>
                  <label style={{ fontSize: 11, color: '#64748B', display: 'block', marginBottom: 4 }}>Billing Email</label>
                  <input type="email" value={planEdit.billing_email} onChange={(e) => setPlanEdit({ ...planEdit, billing_email: e.target.value })}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '2px solid #E2E8F0', fontSize: 13 }} />
                </div>
                <button onClick={savePlanEdit} disabled={savingPlan}
                  style={{ padding: '10px 18px', borderRadius: 8, background: '#0D7377', border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: savingPlan ? 'not-allowed' : 'pointer', opacity: savingPlan ? 0.7 : 1 }}>
                  {savingPlan ? 'Saving…' : 'Save Plan & Limits'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 8 }}>
                Blank limit fields follow the plan defaults ({PLANS[planEdit.plan]?.perks}). Limits are enforced immediately — invites, device pairing and check-ins stop at the cap.
              </div>
            </div>

            {/* Feature access — per-org overrides on top of the plan */}
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Shield size={16} color="#0D7377" /> Feature Access
            </h3>
            <div style={{ padding: 14, background: '#F8FAFC', borderRadius: 12, marginBottom: 24 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8, marginBottom: 12 }}>
                {FEATURE_LIST.map(f => {
                  const on = effectiveFeature(planEdit.plan, featureOverrides, f.key);
                  const planDefault = PLAN_FEATURES[planEdit.plan]?.includes(f.key);
                  return (
                    <label key={f.key} style={{
                      display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer',
                      padding: '9px 11px', borderRadius: 8,
                      background: on ? '#F0FDFA' : '#fff',
                      border: on ? '1px solid #5EEAD4' : '1px solid #E2E8F0'
                    }}>
                      <input type="checkbox" checked={on} onChange={() => toggleFeature(f.key)} />
                      <span style={{ flex: 1 }}>{f.label}</span>
                      {!planDefault && on && <span style={{ fontSize: 10, fontWeight: 700, color: '#B45309', background: '#FEF3C7', padding: '1px 6px', borderRadius: 8 }}>ADD-ON</span>}
                      {planDefault && !on && <span style={{ fontSize: 10, fontWeight: 700, color: '#991B1B', background: '#FEF2F2', padding: '1px 6px', borderRadius: 8 }}>REMOVED</span>}
                    </label>
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: 11, color: '#94A3B8' }}>
                  The {PLANS[planEdit.plan]?.label} plan includes: {PLAN_FEATURES[planEdit.plan]?.length ? PLAN_FEATURES[planEdit.plan].join(', ') : 'no paid features'}. Checking a box grants or removes that feature for this customer only.
                </div>
                <button onClick={saveFeatures} disabled={savingFeatures}
                  style={{ padding: '9px 16px', borderRadius: 8, background: '#0D7377', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: savingFeatures ? 'not-allowed' : 'pointer', opacity: savingFeatures ? 0.7 : 1 }}>
                  {savingFeatures ? 'Saving…' : 'Save Features'}
                </button>
              </div>
            </div>

            {/* Backups — nightly snapshots for orgs with the backups feature */}
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Activity size={16} color="#0D7377" /> Backups
              <button onClick={generateBackup} disabled={backupBusy}
                style={{ marginLeft: 'auto', padding: '7px 12px', borderRadius: 8, background: '#F0FDFA', border: '1px solid #5EEAD4', color: '#0F766E', fontSize: 12, fontWeight: 700, cursor: backupBusy ? 'not-allowed' : 'pointer' }}>
                {backupBusy ? 'Working…' : 'Snapshot Now'}
              </button>
            </h3>
            <div style={{ padding: 14, background: '#F8FAFC', borderRadius: 12, marginBottom: 24 }}>
              {backupsError && (
                <div style={{ fontSize: 12, color: '#991B1B', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 12px', marginBottom: 10 }}>{backupsError}</div>
              )}
              {!effectiveFeature(planEdit.plan, featureOverrides, 'backups') && (
                <div style={{ fontSize: 12, color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px', marginBottom: 10 }}>
                  Nightly backups are OFF for this org (the backups feature is not enabled above). Snapshots you create manually still appear here.
                </div>
              )}
              {orgBackups.length === 0 && !backupsError ? (
                <div style={{ fontSize: 12, color: '#94A3B8' }}>No snapshots yet — nightly ones appear after 03:00 UTC once the feature is enabled.</div>
              ) : (
                orgBackups.slice(0, 8).map(b => (
                  <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 10px', background: '#fff', borderRadius: 8, marginBottom: 6, border: '1px solid #E2E8F0' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#0F172A' }}>{new Date(b.created_at).toLocaleString()}</span>
                    <span style={{ fontSize: 11, color: '#64748B' }}>
                      {b.kind}{b.counts ? ` · ${b.counts.users ?? 0} users, ${b.counts.hosts ?? 0} hosts, ${b.counts.visits ?? 0} visits` : ''} · {Math.round((b.size_bytes || 0) / 1024)} KB
                    </span>
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      <button onClick={() => downloadBackup(b.id, true)}
                        style={{ padding: '5px 10px', borderRadius: 6, background: '#F1F5F9', border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#334155' }}>
                        Download
                      </button>
                      {confirmRestore?.id === b.id ? (
                        <>
                          <button onClick={restoreBackup} disabled={backupBusy}
                            style={{ padding: '5px 10px', borderRadius: 6, background: '#DC2626', border: 'none', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                            {backupBusy ? 'Restoring…' : 'Confirm restore (replaces ALL current data)'}
                          </button>
                          <button onClick={() => setConfirmRestore(null)}
                            style={{ padding: '5px 10px', borderRadius: 6, background: '#F1F5F9', border: 'none', fontSize: 11, cursor: 'pointer' }}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button onClick={() => setConfirmRestore(b)}
                          style={{ padding: '5px 10px', borderRadius: 6, background: '#FEF2F2', border: 'none', color: '#991B1B', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                          Restore
                        </button>
                      )}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
              {[
                { label: 'Organization ID', value: viewOrg.id },
                { label: 'Status', value: viewOrg.status },
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
              <button onClick={() => setShowInvite(!showInvite)}
                style={{ marginLeft: 'auto', padding: '7px 12px', borderRadius: 8, background: '#F0FDFA', border: '1px solid #5EEAD4', color: '#0F766E', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {showInvite ? '− Cancel' : '+ Invite User'}
              </button>
            </h3>
            {showInvite && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', padding: 12, background: '#F0FDFA', borderRadius: 10, marginBottom: 12, border: '1px solid #99F6E4' }}>
                <div style={{ flex: '1 1 110px' }}>
                  <label style={{ fontSize: 11, color: '#0F766E', display: 'block', marginBottom: 3 }}>First name</label>
                  <input type="text" value={inviteForm.first_name} onChange={(e) => setInviteForm({ ...inviteForm, first_name: e.target.value })}
                    style={{ width: '100%', padding: '9px 10px', borderRadius: 8, border: '1px solid #99F6E4', fontSize: 13 }} />
                </div>
                <div style={{ flex: '1 1 110px' }}>
                  <label style={{ fontSize: 11, color: '#0F766E', display: 'block', marginBottom: 3 }}>Last name</label>
                  <input type="text" value={inviteForm.last_name} onChange={(e) => setInviteForm({ ...inviteForm, last_name: e.target.value })}
                    style={{ width: '100%', padding: '9px 10px', borderRadius: 8, border: '1px solid #99F6E4', fontSize: 13 }} />
                </div>
                <div style={{ flex: '2 1 180px' }}>
                  <label style={{ fontSize: 11, color: '#0F766E', display: 'block', marginBottom: 3 }}>Email</label>
                  <input type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                    style={{ width: '100%', padding: '9px 10px', borderRadius: 8, border: '1px solid #99F6E4', fontSize: 13 }} />
                </div>
                <div style={{ flex: '0 1 130px' }}>
                  <label style={{ fontSize: 11, color: '#0F766E', display: 'block', marginBottom: 3 }}>Role</label>
                  <select value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
                    style={{ width: '100%', padding: '9px 10px', borderRadius: 8, border: '1px solid #99F6E4', fontSize: 13, background: '#fff' }}>
                    <option value="receptionist">Receptionist</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <button onClick={inviteUser} disabled={inviteBusy}
                  style={{ padding: '9px 16px', borderRadius: 8, background: '#0D7377', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: inviteBusy ? 'not-allowed' : 'pointer', opacity: inviteBusy ? 0.7 : 1 }}>
                  {inviteBusy ? 'Inviting…' : 'Send Invite'}
                </button>
              </div>
            )}
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
                        {u.id !== user?.id && (
                          <button onClick={() => toggleUserStatus(u)}
                            title={u.is_active ? 'Deactivate — they immediately lose access (account & history kept)' : 'Reactivate this user'}
                            style={{ padding: '7px 12px', borderRadius: 8, background: u.is_active ? '#FEF2F2' : '#DCFCE7', border: 'none', color: u.is_active ? '#991B1B' : '#166534', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            {u.is_active ? 'Deactivate' : 'Reactivate'}
                          </button>
                        )}
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

            {/* Tech Support Access — grant YOUR existing team members access to this org */}
            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 12, padding: 16, marginBottom: 24 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#92400E', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Wrench size={16} /> Tech Support Access
              </div>
              <div style={{ fontSize: 12, color: '#92400E', marginBottom: 12 }}>
                Give members of <b>your</b> organization access to this customer. They'll get an organization switcher in their sidebar and can sign in as support — no new accounts or passwords needed.
              </div>

              {supportError && (
                <div style={{ fontSize: 12, color: '#991B1B', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
                  {supportError}
                </div>
              )}

              {/* Current assignments */}
              {supportList.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  {supportList.map(s => (
                    <div key={s.user_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#fff', borderRadius: 8, marginBottom: 6, border: '1px solid #FDE68A' }}>
                      <div style={{ fontSize: 13 }}>
                        <b>{s.first_name} {s.last_name}</b> <span style={{ color: '#92400E' }}>· {s.email}</span>
                      </div>
                      <button onClick={() => revokeSupport(s.user_id)}
                        style={{ padding: '6px 12px', borderRadius: 6, background: '#FEF2F2', border: 'none', color: '#991B1B', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {supportList.length === 0 && !supportError && (
                <div style={{ fontSize: 12, color: '#B45309', marginBottom: 12 }}>Nobody from your team has access to this organization yet.</div>
              )}

              {/* Assign an existing member of your org */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <select value={supportPick} onChange={(e) => setSupportPick(e.target.value)}
                  style={{ flex: 1, minWidth: 220, padding: '10px 12px', borderRadius: 8, border: '2px solid #E2E8F0', fontSize: 13, background: '#fff' }}>
                  <option value="">Pick a member of your team…</option>
                  {candidates
                    .filter(c => !supportList.some(s => s.user_id === c.id))
                    .map(c => (
                      <option key={c.id} value={c.id}>{c.first_name} {c.last_name} — {c.email}</option>
                    ))}
                </select>
                <button onClick={grantSupport}
                  style={{ padding: '10px 16px', borderRadius: 8, background: '#D97706', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  Grant Access
                </button>
              </div>

              {/* Optional: dedicated support login (separate account inside the customer org) */}
              <div style={{ marginTop: 12, borderTop: '1px dashed #FDE68A', paddingTop: 10 }}>
                <button onClick={() => setShowSupport(!showSupport)}
                  style={{ background: 'none', border: 'none', color: '#B45309', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
                  {showSupport ? '− Hide advanced option' : '+ Or create a dedicated support login inside this organization'}
                </button>
                {showSupport && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <input type="email" placeholder="new support account email" value={supportForm.email}
                      onChange={(e) => setSupportForm({ ...supportForm, email: e.target.value })}
                      style={{ flex: 1, minWidth: 200, padding: '10px 12px', borderRadius: 8, border: '2px solid #E2E8F0', fontSize: 13 }} />
                    <button onClick={createSupportAdmin}
                      style={{ padding: '10px 16px', borderRadius: 8, background: '#0D7377', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                      Create
                    </button>
                  </div>
                )}
              </div>
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
              <button onClick={() => setViewOrg(null)}
                style={{ flex: 1, padding: '14px', borderRadius: 10, background: '#F1F5F9', border: 'none', fontWeight: 600, cursor: 'pointer' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE ORGANIZATION MODAL */}
      {showCreate && (
        <div className="responsive-modal"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110, padding: 20
        }}>
          <div style={{
            background: '#fff', borderRadius: 20, padding: 32, width: '100%', maxWidth: 520,
            maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 80px rgba(0,0,0,0.3)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A' }}>New Organization</h2>
              <button onClick={() => setShowCreate(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }}>
                <X size={22} />
              </button>
            </div>

            {createdResult ? (
              <div>
                <div style={{ padding: 16, background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 12, marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, color: '#065F46', fontSize: 15, marginBottom: 6 }}>
                    ✓ {createdResult.organization.name} is live ({PLANS[createdResult.organization.plan]?.label} plan)
                  </div>
                  <div style={{ fontSize: 13, color: '#065F46', marginBottom: 12 }}>
                    Admin account created for <b>{createdResult.admin_email}</b> — credentials were emailed. You can also copy them here (shown once):
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <code style={{ fontSize: 18, fontWeight: 700, background: '#fff', padding: '6px 14px', borderRadius: 8, border: '1px solid #A7F3D0' }}>{createdResult.temp_password}</code>
                    <button onClick={() => navigator.clipboard.writeText(createdResult.temp_password)}
                      style={{ padding: '8px 12px', borderRadius: 8, background: '#059669', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      Copy
                    </button>
                  </div>
                  {createdResult.trial_ends_at && (
                    <div style={{ fontSize: 12, color: '#047857', marginTop: 10 }}>Free trial ends {new Date(createdResult.trial_ends_at).toLocaleDateString()}.</div>
                  )}
                </div>
                <button onClick={() => setShowCreate(false)}
                  style={{ width: '100%', padding: '13px', borderRadius: 10, background: '#0D7377', border: 'none', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                  Done
                </button>
              </div>
            ) : (
              <div>
                <p style={{ color: '#64748B', fontSize: 13, marginBottom: 18 }}>
                  Manually provision a customer — creates the organization and its first admin, and emails them their login.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>Organization name *</label>
                    <input type="text" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                      placeholder="Acme Corp" style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14 }} />
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>Plan</label>
                      <select value={createForm.plan} onChange={(e) => setCreateForm({ ...createForm, plan: e.target.value })}
                        style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14, background: '#fff' }}>
                        <option value="free">Free (trial)</option>
                        <option value="pro">Pro ($49/mo)</option>
                        <option value="enterprise">Enterprise ($149/mo)</option>
                      </select>
                    </div>
                    {createForm.plan === 'free' && (
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>Trial days</label>
                        <input type="number" min="1" max="90" value={createForm.trial_days} onChange={(e) => setCreateForm({ ...createForm, trial_days: e.target.value })}
                          style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14 }} />
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>Admin first name *</label>
                      <input type="text" value={createForm.admin_first_name} onChange={(e) => setCreateForm({ ...createForm, admin_first_name: e.target.value })}
                        style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14 }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>Admin last name *</label>
                      <input type="text" value={createForm.admin_last_name} onChange={(e) => setCreateForm({ ...createForm, admin_last_name: e.target.value })}
                        style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14 }} />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>Admin email * (their login)</label>
                    <input type="email" value={createForm.admin_email} onChange={(e) => setCreateForm({ ...createForm, admin_email: e.target.value })}
                      placeholder="admin@acme.com" style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>Billing email (optional — defaults to admin email)</label>
                    <input type="email" value={createForm.billing_email} onChange={(e) => setCreateForm({ ...createForm, billing_email: e.target.value })}
                      style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14 }} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 22 }}>
                  <button onClick={() => setShowCreate(false)}
                    style={{ flex: 1, padding: '13px', borderRadius: 10, background: '#F1F5F9', border: 'none', fontWeight: 600, cursor: 'pointer' }}>
                    Cancel
                  </button>
                  <button onClick={createOrganization} disabled={createBusy}
                    style={{ flex: 1, padding: '13px', borderRadius: 10, background: '#0D7377', border: 'none', color: '#fff', fontWeight: 700, cursor: createBusy ? 'not-allowed' : 'pointer', opacity: createBusy ? 0.7 : 1 }}>
                    {createBusy ? 'Creating…' : 'Create Organization'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
