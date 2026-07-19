import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useStore } from '../utils/store';
import Toaster from './Toaster';
import {
  LayoutDashboard, Users, Calendar, Settings, LogOut,
  QrCode, Package, Shield, Bell, Menu, X
} from 'lucide-react';

export default function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(window.innerWidth < 768);

  React.useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const logout = useStore((s) => s.logout);
  const user = useStore((s) => s.user);
  const org = useStore((s) => s.organization);
  const navigate = useNavigate();

  const navItems = [
    { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/visits', icon: Users, label: 'Visits' },
    { path: '/hosts', icon: Users, label: 'Hosts' },
    { path: '/pre-registered', icon: Calendar, label: 'Pre-Registered' },
    { path: '/settings', icon: Settings, label: 'Settings' },
    { path: '/super-admin', icon: Shield, label: 'Super Admin', requireRole: 'super_admin' },
  ];

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
              <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.2, whiteSpace: 'nowrap' }}>Sentinels Sign-In</div>
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

        {/* Nav */}
        <nav style={{ flex: 1, padding: '16px 12px' }}>
          {navItems.filter(i => !i.requireRole || user?.role === i.requireRole).map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={() => isMobile && setMobileOpen(false)}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 16px', borderRadius: 10,
                color: isActive ? '#14FFEC' : '#94A3B8',
                background: isActive ? 'rgba(13, 115, 119, 0.2)' : 'transparent',
                textDecoration: 'none',
                fontSize: 14, fontWeight: 500,
                transition: 'all 0.2s',
                marginBottom: 4,
              })}
            >
              <item.icon size={20} />
              {(!isMobile ? sidebarOpen : true) && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div style={{ padding: '16px', borderTop: '1px solid #1E293B' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'linear-gradient(135deg, #0D7377, #14FFEC)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 600, fontSize: 14
            }}>
              {user?.first_name?.[0]}{user?.last_name?.[0]}
            </div>
            {sidebarOpen && (
              <div style={{ fontSize: 13 }}>
                <div style={{ fontWeight: 600 }}>{user?.first_name} {user?.last_name}</div>
                <div style={{ color: '#94A3B8', fontSize: 11 }}>{org?.name}</div>
              </div>
            )}
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
        <Outlet />
      </main>
    </div>
  );
}
