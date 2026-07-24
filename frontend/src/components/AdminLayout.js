import React from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from 'react-query';
import { useStore } from '../utils/store';
import api from '../utils/api';
import { toast } from '../utils/toast';
import Toaster from './Toaster';
import {
  LayoutDashboard, Users, Calendar, Settings, LogOut, Monitor, UserPlus,
  Shield, ShieldAlert, Menu, X, FileCheck, BarChart3, ArrowLeftRight, Undo2
} from 'lucide-react';

export default function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(window.innerWidth < 768);
  const [supportOrgs, setSupportOrgs] = React.useState([]);
  const [switching, setSwitching] = React.useState(false);

  React.useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const logout = useStore((s) => s.logout);
  const user = useStore((s) => s.user);
  const org = useStore((s) => s.organization);
  const setAuth = useStore((s) => s.setAuth);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  // Refresh the signed-in user (picks up role/permission changes) and load
  // the list of organizations this user may switch into for tech support
  React.useEffect(() => {
    api.get('/auth/me').then(r => {
      const me = r.data;
      setAuth(useStore.getState().token, me, { id: me.org_id, name: me.org_name });
    }).catch(() => {});
    api.get('/auth/support-orgs').then(r => setSupportOrgs(r.data || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch into another organization (tech support) or back to your own
  const switchTo = async (orgId) => {
    if (!orgId || switching) return;
    setSwitching(true);
    try {
      const r = await api.post('/auth/switch-org', { org_id: orgId });
      // Store the new token first so /auth/me authenticates with the new scope
      setAuth(r.data.token, user, { id: orgId, name: r.data.org_name });
      const me = await api.get('/auth/me');
      setAuth(r.data.token, me.data, { id: me.data.org_id, name: me.data.org_name || r.data.org_name });
      queryClient.clear(); // drop every cached query from the previous org
      navigate('/');
      toast(`Now viewing ${me.data.org_name || r.data.org_name}`, 'success');
    } catch (err) {
      toast(err.response?.data?.error || 'Could not switch organization', 'error');
    } finally {
      setSwitching(false);
    }
  };

  // Which menu entries is this user allowed to see?
  const hasPerm = (p) => {
    if (!user) return false;
    if (user.switched) return true; // support sessions get full access to the customer org
    if (user.role === 'admin' || user.role === 'super_admin') return true;
    if (Array.isArray(user.permissions)) return user.permissions.includes(p);
    return ['visits', 'prereg'].includes(p); // receptionist fallback
  };

  // Paid-feature gating from the plan (resolved server-side into user.features)
  const hasFeature = (f) => {
    if (!user) return true;
    if (user.switched) return true;
    if (!Array.isArray(user.features)) return true; // older session — don't hide anything
    return user.features.includes(f);
  };

  const navItems = [
    { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/visits', icon: Users, label: 'Visits', perm: 'visits' },
    { path: '/visits?watchlist=1', icon: ShieldAlert, label: 'Watchlist', perm: 'visits' },
    { path: '/hosts', icon: Users, label: 'Hosts', perm: 'hosts' },
    { path: '/pre-registered', icon: Calendar, label: 'Pre-Registered', perm: 'prereg' },
    { path: '/devices', icon: Monitor, label: 'Devices', perm: 'devices' },
    { path: '/team', icon: UserPlus, label: 'Team', perm: 'team' },
    { path: '/reports', icon: BarChart3, label: 'Reports', perm: 'reports', feature: 'reports' },
    { path: '/compliance', icon: FileCheck, label: 'Compliance', perm: 'compliance', feature: 'compliance' },
    { path: '/settings', icon: Settings, label: 'Settings', perm: 'settings' },
    { path: '/super-admin', icon: Shield, label: 'Super Admin', requireRole: 'super_admin' },
  ];

  const visibleNav = navItems.filter(i =>
    i.requireRole ? (user?.role === i.requireRole && !user?.switched)
                  : ((!i.perm || hasPerm(i.perm)) && (!i.feature || hasFeature(i.feature)))
  );

  // Trial / suspension banners
  const trialEnd = user?.trial_ends_at ? new Date(user.trial_ends_at) : null;
  const trialExpired = user?.org_plan === 'free' && trialEnd && trialEnd < new Date();
  const trialDaysLeft = user?.org_plan === 'free' && trialEnd && trialEnd >= new Date()
    ? Math.ceil((trialEnd - Date.now()) / 864e5) : null;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F1F5F9' }}>
      {/* Desktop Sidebar */}
      <aside
        style={{
          width: isMobile ? 260 : (sidebarOpen ? 260 : 80),
          background: '#0F172A',
          color: '#fff',
          transition: 'transform 0.3s ease, width 0.3s ease',
          position: 'fixed',
          top: 0, left: 0, bottom: 0,
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          transform: isMobile && !mobileOpen ? 'translateX(-100%)' : 'translateX(0)',
        }}
      >
        {/* Logo */}
        <div style={{ padding: '24px 20px', borderBottom: '1px solid #1E293B', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: 'linear-gradient(135deg, #0D7377, #14FFEC)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontSize: 20, color: '#fff'
          }}>
            S
          </div>
          {sidebarOpen && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.2, whiteSpace: 'nowrap' }}>Sentinels Kiosk</div>
              <div style={{ fontSize: 11, color: '#94A3B8' }}>Visitor Management</div>
            </div>
          )}
        </div>

        {/* Toggle */}
        {!isMobile && (<button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          style={{
            position: 'absolute', right: -12, top: 28,
            width: 24, height: 24, borderRadius: '50%',
            background: '#0D7377', border: 'none', color: '#fff',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12
          }}
        >
          {sidebarOpen ? '<' : '>'}
        </button>)}

        {/* Organization switcher — tech support access to customer orgs */}
        {supportOrgs.length > 0 && (!isMobile ? sidebarOpen : true) && (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #1E293B' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
              <ArrowLeftRight size={11} /> {user?.switched ? 'Viewing as support' : 'Switch organization'}
            </div>
            <select
              value=""
              disabled={switching}
              onChange={(e) => { if (e.target.value) switchTo(e.target.value); }}
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 12,
                background: '#1E293B', color: '#E2E8F0', border: '1px solid #334155',
                cursor: switching ? 'wait' : 'pointer'
              }}
            >
              <option value="">{switching ? 'Switching…' : 'Open a customer org…'}</option>
              {supportOrgs
                .filter(o => o.id !== org?.id)
                .map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        )}

        {/* Nav */}
        <nav style={{ flex: 1, padding: '16px 12px' }}>
          {visibleNav.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={() => isMobile && setMobileOpen(false)}
              style={({ isActive }) => {
                // Query-aware: Team is only active on /settings?section=team,
                // Settings only on plain /settings (no query)
                const active = item.path.includes('?')
                  ? (location.pathname + location.search) === item.path
                  : (item.path === '/settings' ? isActive && !location.search
                     : item.path === '/visits' ? isActive && location.search !== '?watchlist=1'
                     : isActive);
                return {
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 16px', borderRadius: 10,
                color: active ? '#14FFEC' : '#94A3B8',
                background: active ? 'rgba(13, 115, 119, 0.2)' : 'transparent',
                textDecoration: 'none',
                fontSize: 14, fontWeight: 500,
                transition: 'all 0.2s',
                marginBottom: 4,
                };
              }}
            >
              <item.icon size={20} />
              {(!isMobile ? sidebarOpen : true) && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div style={{ padding: '16px', borderTop: '1px solid #1E293B' }}>
          <div
            onClick={() => { navigate('/settings'); setMobileOpen(false); }}
            title="Open your settings"
            style={{
              display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
              padding: '8px', margin: '-8px -8px 4px', borderRadius: 10,
              cursor: 'pointer', transition: 'background 0.15s'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#1E293B')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <div style={{
              width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, #0D7377, #14FFEC)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 600, fontSize: 14
            }}>
              {user?.first_name?.[0]}{user?.last_name?.[0]}
            </div>
            {sidebarOpen && (
              <div style={{ fontSize: 13, flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{user?.first_name} {user?.last_name}</div>
                <div style={{ color: '#94A3B8', fontSize: 11 }}>{org?.name}</div>
              </div>
            )}
            {sidebarOpen && <Settings size={15} color="#64748B" style={{ flexShrink: 0 }} />}
          </div>
          <button
            onClick={handleLogout}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', borderRadius: 8,
              background: 'transparent', border: '1px solid #334155',
              color: '#94A3B8', cursor: 'pointer', fontSize: 13
            }}
          >
            <LogOut size={16} /> {sidebarOpen && 'Sign Out'}
          </button>
        </div>
      </aside>

      {/* Mobile hamburger */}
      {isMobile && (
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          style={{
            position: 'fixed', top: 12, left: 12, zIndex: 60,
            width: 44, height: 44, borderRadius: 12,
            background: '#0F172A', border: 'none', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
          }}
        >
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      )}

      {/* Mobile overlay */}
      {isMobile && mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 40 }}
        />
      )}

      <Toaster />

      {/* Main Content */}
      <main style={{
        marginLeft: isMobile ? 0 : (sidebarOpen ? 260 : 80),
        flex: 1, transition: 'margin-left 0.3s ease',
        padding: isMobile ? '64px 16px 16px' : 32, minHeight: '100vh'
      }}>
        {/* Suspended account banner */}
        {user?.org_status === 'suspended' && !user?.switched && (
          <div style={{
            background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12,
            padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#991B1B'
          }}>
            <b>This account is suspended.</b> You can view your data but can't make changes. Contact Sentinels at info@sentinelsit.com to reactivate.
          </div>
        )}

        {/* Trial banners */}
        {trialExpired && !user?.switched && user?.org_status !== 'suspended' && (
          <div style={{
            background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12,
            padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#991B1B'
          }}>
            <b>Your trial expired on {trialEnd.toLocaleDateString()}.</b> You can still view everything, but changes are blocked until you upgrade — contact Sentinels at info@sentinelsit.com to pick a plan.
          </div>
        )}
        {trialDaysLeft !== null && trialDaysLeft <= 3 && !trialExpired && !user?.switched && (
          <div style={{
            background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 12,
            padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#92400E'
          }}>
            <b>{trialDaysLeft === 0 ? 'Your trial ends today' : `Your trial ends in ${trialDaysLeft} day${trialDaysLeft !== 1 ? 's' : ''}`}.</b> Contact Sentinels at info@sentinelsit.com to keep your account active.
          </div>
        )}

        {/* Support-mode banner — always visible while inside a customer org */}
        {user?.switched && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
            background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 12,
            padding: '10px 16px', marginBottom: 20
          }}>
            <div style={{ fontSize: 13, color: '#92400E', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Shield size={15} />
              <span>
                You're viewing <b>{org?.name}</b> as tech support. Changes you make here affect this customer.
              </span>
            </div>
            <button
              onClick={() => switchTo(user.home_org_id)}
              disabled={switching}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8,
                background: '#D97706', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700,
                cursor: switching ? 'wait' : 'pointer', whiteSpace: 'nowrap'
              }}
            >
              <Undo2 size={13} /> {switching ? 'Returning…' : `Back to ${user.home_org_name || 'my organization'}`}
            </button>
          </div>
        )}
        {/* key remounts the page on every tab switch, so unsaved form state
            (e.g. Settings toggles) can't silently linger across tabs */}
        <Outlet key={location.pathname} />
      </main>
    </div>
  );
}
