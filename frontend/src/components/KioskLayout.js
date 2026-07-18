import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import api from '../utils/api';

export default function KioskLayout() {
  const navigate = useNavigate();

  // Heartbeat: tell the backend this kiosk is alive (used for offline alerts)
  React.useEffect(() => {
    const orgId = localStorage.getItem('kiosk_org_id');
    if (!orgId) return;
    const beat = () => api.post('/kiosk/heartbeat', { org_id: orgId }).catch(() => {});
    beat();
    const t = setInterval(beat, 60000);
    return () => clearInterval(t);
  }, []);

  // Exit kiosk mode - hidden admin button (tap top-right corner 5 times)
  const [tapCount, setTapCount] = React.useState(0);
  React.useEffect(() => {
    if (tapCount >= 5) {
      if (window.confirm('Exit kiosk mode?')) {
        window.location.href = '/login';
      }
      setTapCount(0);
    }
  }, [tapCount]);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0D7377 0%, #0A5C5F 50%, #0F172A 100%)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: 24, position: 'relative', overflow: 'hidden'
    }}>
      {/* Decorative background elements */}
      <div style={{
        position: 'absolute', top: -100, right: -100,
        width: 400, height: 400, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(20,255,236,0.1) 0%, transparent 70%)'
      }} />
      <div style={{
        position: 'absolute', bottom: -150, left: -150,
        width: 500, height: 500, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(255,107,53,0.08) 0%, transparent 70%)'
      }} />

      {/* Exit button (hidden) */}
      <div
        onClick={() => setTapCount(c => c + 1)}
        style={{
          position: 'absolute', top: 0, right: 0,
          width: 60, height: 60, zIndex: 100, cursor: 'default'
        }}
      />

      <Outlet />
    </div>
  );
}
