import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Search, CheckCircle, User, Clock } from 'lucide-react';
import api from '../utils/api';

export default function KioskSignOut() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [visitors, setVisitors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);

  const orgId = searchParams.get('org') || localStorage.getItem('kiosk_org_id') || '00000000-0000-0000-0000-000000000001';

  // Load ALL active visitors on page load
  useEffect(() => {
    loadVisitors('');
  }, [orgId]);

  const loadVisitors = async (searchTerm) => {
    setLoading(true);
    try {
      const res = await api.get(`/visits/active/public/${orgId}?search=${searchTerm}`);
      setVisitors(res.data || []);
    } catch (err) {
      console.error('Failed to load visitors:', err);
      setVisitors([]);
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  };

  const handleSearch = () => {
    loadVisitors(search);
  };

  const handleCheckOut = async (visitId) => {
    try {
      await api.post(`/visits/${visitId}/check-out`);
      setDone(true);
      setTimeout(() => {
        setDone(false);
        setVisitors(prev => prev.filter(v => v.id !== visitId));
      }, 3000);
    } catch (err) {
      alert('Check-out failed: ' + (err.response?.data?.error || 'Unknown error'));
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

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 24 }}>
        <input
          type="text" value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          style={inputStyle} placeholder="Search by name or badge number..."
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

      {/* Active Visitors List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {loading && initialLoad && (
          <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.6)' }}>
            Loading visitors...
          </div>
        )}

        {!loading && visitors.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '40px 20px',
            background: 'rgba(255,255,255,0.05)', borderRadius: 16,
            border: '1px solid rgba(255,255,255,0.1)'
          }}>
            <User size={48} color="rgba(255,255,255,0.3)" style={{ marginBottom: 16 }} />
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 18 }}>No visitors currently on site</p>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, marginTop: 8 }}>
              Visitors will appear here after they check in
            </p>
          </div>
        )}

        {visitors.map(v => (
          <div key={v.id} style={{
            background: 'rgba(255,255,255,0.1)', borderRadius: 16,
            padding: 20, border: '1px solid rgba(255,255,255,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: 'linear-gradient(135deg, #0D7377, #14FFEC)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: 16, color: '#fff'
              }}>
                {v.visitor_first_name?.[0]}{v.visitor_last_name?.[0]}
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>
                  {v.visitor_first_name} {v.visitor_last_name}
                </div>
                <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>
                  {v.visitor_company && `${v.visitor_company} • `}
                  Badge: <span style={{ fontFamily: 'monospace', color: '#14FFEC' }}>{v.badge_number}</span>
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Clock size={12} /> Checked in at {v.checked_in_at ? new Date(v.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}
                </div>
              </div>
            </div>
            <button
              onClick={() => handleCheckOut(v.id)}
              style={{
                padding: '12px 24px', borderRadius: 12,
                background: '#FF6B35', border: 'none', color: '#fff',
                fontWeight: 600, cursor: 'pointer', fontSize: 16,
                boxShadow: '0 4px 15px rgba(255, 107, 53, 0.3)'
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
