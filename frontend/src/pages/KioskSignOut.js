import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, CheckCircle } from 'lucide-react';
import api from '../utils/api';

export default function KioskSignOut() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [visitors, setVisitors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSearch = async () => {
    setLoading(true);
    try {
      const orgId = localStorage.getItem('kiosk_org_id') || '00000000-0000-0000-0000-000000000001';
      const res = await api.get(`/visits/active?org_id=${orgId}&search=${search}`);
      setVisitors(res.data);
    } catch (err) {
      // Demo data
      setVisitors([
        { id: '1', visitor_first_name: 'John', visitor_last_name: 'Doe', visitor_company: 'Acme Inc.', badge_number: '0427', checked_in_at: new Date().toISOString() },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckOut = async (visitId) => {
    try {
      await api.post(`/visits/${visitId}/check-out`);
      setDone(true);
      setTimeout(() => {
        setDone(false);
        setVisitors([]);
        setSearch('');
      }, 3000);
    } catch (err) {
      alert('Check-out failed');
    }
  };

  if (done) {
    return (
      <div style={{ textAlign: 'center', zIndex: 1 }}>
        <CheckCircle size={80} color="#2ECC71" style={{ marginBottom: 24 }} />
        <h2 style={{ fontSize: 42, fontWeight: 800, color: '#fff' }}>Signed Out!</h2>
        <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 18, marginTop: 8 }}>Thank you for visiting</p>
      </div>
    );
  }

  const inputStyle = {
    width: '100%', padding: '20px 24px', borderRadius: 16,
    border: '2px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.1)',
    color: '#fff', fontSize: 22, outline: 'none',
    backdropFilter: 'blur(10px)'
  };

  return (
    <div style={{ width: '100%', maxWidth: 600, zIndex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
        <button
          onClick={() => navigate('/kiosk')}
          style={{
            width: 48, height: 48, borderRadius: 14,
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer'
          }}
        >
          <ArrowLeft size={24} />
        </button>
        <h2 style={{ fontSize: 28, fontWeight: 700, color: '#fff' }}>Sign Out</h2>
      </div>

      <div style={{ position: 'relative', marginBottom: 24 }}>
        <input
          type="text" value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          style={inputStyle} placeholder="Enter badge number or name..."
        />
        <button
          onClick={handleSearch}
          style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            padding: '12px 20px', borderRadius: 12,
            background: '#FF6B35', border: 'none', color: '#fff',
            fontWeight: 600, cursor: 'pointer', fontSize: 16
          }}
        >
          <Search size={20} />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {visitors.map(v => (
          <div key={v.id} style={{
            background: 'rgba(255,255,255,0.1)', borderRadius: 16,
            padding: 20, border: '1px solid rgba(255,255,255,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between'
          }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>
                {v.visitor_first_name} {v.visitor_last_name}
              </div>
              <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>
                {v.visitor_company} • Badge: {v.badge_number}
              </div>
            </div>
            <button
              onClick={() => handleCheckOut(v.id)}
              style={{
                padding: '12px 24px', borderRadius: 12,
                background: '#FF6B35', border: 'none', color: '#fff',
                fontWeight: 600, cursor: 'pointer', fontSize: 16
              }}
            >
              Sign Out
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
