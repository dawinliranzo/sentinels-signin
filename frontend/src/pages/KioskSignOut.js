import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Search, CheckCircle, User, Clock, QrCode } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import api from '../utils/api';

export default function KioskSignOut() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [visitors, setVisitors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [initialLoad, setInitialLoad] = useState(true);
  const [scanMode, setScanMode] = useState(false);
  const scannerRef = useRef(null);
  const processingRef = useRef(false);

  // CRITICAL FIX: No fallback to demo org. Must have org ID.
  const orgId = searchParams.get('org') || localStorage.getItem('kiosk_org_id');

  // Store org — but DO NOT list visitors until the visitor types their own name/badge
  useEffect(() => {
    if (orgId) {
      localStorage.setItem('kiosk_org_id', orgId);
    }
  }, [orgId]);

  // QR scanner lifecycle for scan-to-sign-out mode
  useEffect(() => {
    if (!scanMode) return;
    let cancelled = false;
    processingRef.current = false;
    const scanner = new Html5Qrcode('signout-qr-reader');
    scannerRef.current = scanner;

    const onScan = async (decodedText) => {
      if (cancelled || processingRef.current) return;
      processingRef.current = true;
      try { await scanner.stop(); } catch (e) { /* ignore */ }
      let token = decodedText.trim();
      if (token.includes('/check-in/')) {
        token = token.split('/check-in/')[1].split(/[?#/&]/)[0];
      }
      try {
        if (token.startsWith('STAFF:')) {
          // Employee badge: toggles them out (the endpoint flips in->out)
          await api.post('/visits/staff-checkin', { org_id: orgId, host_id: token.slice(6) });
        } else {
          // Pre-registration QR: find the person's active visit and check it out
          const v = await api.get(`/pre-registered/validate-qr/${token}`);
          const visitor = v.data.visitor;
          if (visitor.org_id !== orgId) throw new Error('wrong org');
          const matches = await api.get(`/visits/active/public/${orgId}?search=${encodeURIComponent(visitor.email || visitor.first_name)}`);
          const mine = (matches.data || []).find(x =>
            (visitor.email && x.visitor_email?.toLowerCase() === visitor.email.toLowerCase()) ||
            (x.visitor_first_name === visitor.first_name && x.visitor_last_name === visitor.last_name));
          if (!mine) throw new Error('no active visit');
          await api.post('/visits/public/check-out', { visit_id: mine.id, org_id: orgId });
        }
        setScanMode(false);
        setDone(true);
        setTimeout(() => setDone(false), 3000);
      } catch (err) {
        setScanMode(false);
        setErrorMsg('Could not sign out from that QR — search your name instead.');
        setTimeout(() => setErrorMsg(''), 5000);
      }
    };

    const scanConfig = { fps: 10, qrbox: { width: 260, height: 260 } };
    scanner
      .start({ facingMode: 'user' }, scanConfig, onScan, () => {})
      .catch(() => scanner.start({ facingMode: 'environment' }, scanConfig, onScan, () => {}))
      .catch(() => {
        if (!cancelled) {
          setScanMode(false);
          setErrorMsg('Camera unavailable — search your name instead.');
          setTimeout(() => setErrorMsg(''), 5000);
        }
      });

    return () => {
      cancelled = true;
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current = null;
      }
    };
  }, [scanMode, orgId]);

  // Debounced search: only fetch when 2+ characters typed (privacy: no full roster)
  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) {
      setVisitors([]);
      setInitialLoad(true);
      return;
    }
    const t = setTimeout(() => loadVisitors(term), 300);
    return () => clearTimeout(t);
  }, [search, orgId]);

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
      await api.post('/visits/public/check-out', { visit_id: visitId, org_id: orgId });
      setDone(true);
      setTimeout(() => {
        setDone(false);
        setVisitors(prev => prev.filter(v => v.id !== visitId));
      }, 3000);
    } catch (err) {
      setErrorMsg('Check-out failed: ' + (err.response?.data?.error || 'Please try again'));
      setTimeout(() => setErrorMsg(''), 5000);
    }
  };

  // GUARD: Must have org ID
  if (!orgId) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100vh', textAlign: 'center',
        color: '#fff', padding: 40, zIndex: 1
      }}>
        <h2 style={{ fontSize: 28, marginBottom: 16 }}>Kiosk Error</h2>
        <p style={{ fontSize: 16, opacity: 0.7, marginBottom: 24 }}>
          Organization not configured. Please return to the welcome screen.
        </p>
        <button onClick={() => navigate('/kiosk')}
          style={{
            padding: '14px 32px', borderRadius: 12, background: '#FF6B35',
            border: 'none', color: '#fff', fontSize: 16, fontWeight: 600,
            cursor: 'pointer'
          }}>
          Back to Welcome
        </button>
      </div>
    );
  }

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
          onClick={() => navigate(`/kiosk?org=${orgId}`)}
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

      {scanMode && (
        <div style={{ marginBottom: 24, textAlign: 'center' }}>
          <div id="signout-qr-reader" style={{ width: '100%', maxWidth: 420, margin: '0 auto', borderRadius: 16, overflow: 'hidden', background: '#000' }} />
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, marginTop: 12 }}>
            Point your check-in QR or staff badge at the camera
          </p>
          <button onClick={() => setScanMode(false)}
            style={{ marginTop: 12, padding: '12px 24px', borderRadius: 12, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.25)', color: '#fff', fontSize: 15, cursor: 'pointer' }}>
            Type my name instead
          </button>
        </div>
      )}

      {/* Search */}
      {!scanMode && (
      <>
      <div style={{ position: 'relative', marginBottom: 16 }}>
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

      <button onClick={() => setScanMode(true)}
        style={{
          width: '100%', marginBottom: 24, padding: '14px', borderRadius: 14,
          background: 'rgba(20,255,236,0.12)', border: '2px solid rgba(20,255,236,0.4)',
          color: '#14FFEC', fontSize: 16, fontWeight: 700, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10
        }}>
        <QrCode size={20} /> Sign out with QR instead
      </button>
      </>
      )}

      {/* Active Visitors List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {errorMsg && (
          <div style={{
            marginBottom: 16, padding: '14px 18px', borderRadius: 12,
            background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.5)',
            color: '#FCA5A5', fontSize: 15, fontWeight: 500, textAlign: 'center'
          }}>
            {errorMsg}
          </div>
        )}

        {loading && initialLoad && (
          <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.6)' }}>
            Loading visitors...
          </div>
        )}

        {!loading && visitors.length === 0 && search.trim().length < 2 && (
          <div style={{
            textAlign: 'center', padding: '40px 20px',
            background: 'rgba(255,255,255,0.05)', borderRadius: 16,
            border: '1px solid rgba(255,255,255,0.1)'
          }}>
            <Search size={48} color="rgba(255,255,255,0.3)" style={{ marginBottom: 16 }} />
            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 16, margin: 0 }}>
              Type at least 2 letters of your name or badge number to find your visit
            </p>
          </div>
        )}

        {!loading && visitors.length === 0 && search.trim().length >= 2 && (
          <div style={{
            textAlign: 'center', padding: '40px 20px',
            background: 'rgba(255,255,255,0.05)', borderRadius: 16,
            border: '1px solid rgba(255,255,255,0.1)'
          }}>
            <User size={48} color="rgba(255,255,255,0.3)" style={{ marginBottom: 16 }} />
            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 16, margin: 0 }}>
              No active visit matches "{search.trim()}"
            </p>
          </div>
        )}

        {false && !loading && visitors.length === 0 && (
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
