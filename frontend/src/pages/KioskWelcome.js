import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, LogIn, LogOut, QrCode, CheckCircle, XCircle } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import api from '../utils/api';

export default function KioskWelcome() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Org ID from URL param, or remembered from a previous visit on this device
  const orgId = searchParams.get('org') || localStorage.getItem('kiosk_org_id');

  // mode: welcome | scan | done | already | error
  const [mode, setMode] = useState('welcome');
  const [result, setResult] = useState(null);
  const scannerRef = useRef(null);
  const processingRef = useRef(false);

  useEffect(() => {
    if (orgId) {
      localStorage.setItem('kiosk_org_id', orgId);
    }
  }, [orgId]);

  // Camera lifecycle for scan mode
  useEffect(() => {
    if (mode !== 'scan') return;
    processingRef.current = false;
    const scanner = new Html5Qrcode('qr-reader');
    scannerRef.current = scanner;
    let cancelled = false;

    const onScan = async (text) => {
      if (processingRef.current) return;
      processingRef.current = true;
      try { await scanner.stop(); } catch (e) { /* already stopped */ }

      // QR content is a full URL like https://.../check-in/<token> — extract the token
      let token = text.trim();
      if (token.includes('/check-in/')) {
        token = token.split('/check-in/')[1].split(/[?#/&]/)[0];
      }

      try {
        const v = await api.get(`/pre-registered/validate-qr/${token}`);
        const visitor = v.data.visitor;
        if (visitor.org_id !== orgId) {
          setResult({ name: `${visitor.first_name} ${visitor.last_name}` });
          setMode('error');
          return;
        }
        const r = await api.post('/visits/check-in', {
          org_id: visitor.org_id,
          pre_reg_id: visitor.id,
          visitor_type_id: visitor.visitor_type_id,
          host_id: visitor.host_id,
          first_name: visitor.first_name,
          last_name: visitor.last_name,
          email: visitor.email,
          phone: visitor.phone,
          company: visitor.company,
          purpose: visitor.purpose,
          sign_in_method: 'qr_code'
        });
        setResult({ name: visitor.first_name, badge: r.data?.badge_number });
        setMode(r.data?.already_checked_in ? 'already' : 'done');
        setTimeout(() => setMode('welcome'), 6000);
      } catch (err) {
        setResult({ message: err.response?.data?.error || 'Invalid or expired QR code' });
        setMode('error');
      }
    };

    scanner
      .start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 260, height: 260 } }, onScan, () => {})
      .catch(() => {
        if (!cancelled) {
          setResult({ message: 'Camera unavailable. Please allow camera access, or use Sign In instead.' });
          setMode('error');
        }
      });

    return () => {
      cancelled = true;
      try { scanner.stop().catch(() => {}); } catch (e) { /* noop */ }
    };
  }, [mode, orgId]);

  // GUARD: No org ID = show error screen
  if (!orgId) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', zIndex: 1, maxWidth: 600,
        padding: 40
      }}>
        <div style={{
          width: 80, height: 80, borderRadius: 20,
          background: 'rgba(255,107,53,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 24
        }}>
          <span style={{ fontSize: 40 }}>⚠️</span>
        </div>
        <h1 style={{ fontSize: 32, fontWeight: 700, color: '#fff', marginBottom: 12 }}>
          Kiosk Not Configured
        </h1>
        <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.7)', marginBottom: 32, lineHeight: 1.5 }}>
          This kiosk needs an organization ID to work.<br />
          Please use the URL provided by your administrator.
        </p>
        <div style={{
          background: 'rgba(255,255,255,0.1)', borderRadius: 16,
          padding: '20px 24px', border: '1px solid rgba(255,255,255,0.2)',
          maxWidth: 400
        }}>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
            Example URL format:
          </p>
          <code style={{ fontSize: 12, color: '#14FFEC', fontFamily: 'monospace', wordBreak: 'break-all' }}>
            https://yoursite.com/kiosk?org=your-org-id
          </code>
        </div>
      </div>
    );
  }

  // ─── SCAN MODE ───
  if (mode === 'scan') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 1, maxWidth: 600, textAlign: 'center' }}>
        <h1 style={{ fontSize: 36, fontWeight: 800, color: '#fff', marginBottom: 8 }}>Scan Your QR Code</h1>
        <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.7)', marginBottom: 24 }}>
          Hold the QR code from your invitation email up to the camera
        </p>
        <div style={{
          width: 320, height: 320, borderRadius: 24, overflow: 'hidden',
          border: '4px solid rgba(20,255,236,0.5)', background: '#000',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)'
        }}>
          <div id="qr-reader" style={{ width: '100%', height: '100%' }} />
        </div>
        <button
          onClick={() => setMode('welcome')}
          style={{
            marginTop: 32, padding: '16px 40px', borderRadius: 14,
            background: 'rgba(255,255,255,0.1)', border: '2px solid rgba(255,255,255,0.3)',
            color: '#fff', fontSize: 17, fontWeight: 600, cursor: 'pointer'
          }}
        >
          Cancel
        </button>
      </div>
    );
  }

  // ─── SUCCESS / ALREADY / ERROR SCREENS ───
  if (mode === 'done' || mode === 'already' || mode === 'error') {
    const conf = {
      done:    { icon: <CheckCircle size={90} color="#2ECC71" />, title: `Welcome, ${result?.name || 'visitor'}!`, sub: result?.badge ? `Your badge: ${result.badge}` : "You're checked in" },
      already: { icon: <CheckCircle size={90} color="#14FFEC" />, title: 'Already checked in', sub: result?.badge ? `Active badge: ${result.badge}` : 'Your visit is already active' },
      error:   { icon: <XCircle size={90} color="#FF6B35" />, title: 'Cannot check in', sub: result?.message || 'Invalid QR code for this kiosk' },
    }[mode];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 1, textAlign: 'center', padding: 40 }}>
        {conf.icon}
        <h1 style={{ fontSize: 40, fontWeight: 800, color: '#fff', margin: '24px 0 8px' }}>{conf.title}</h1>
        <p style={{ fontSize: 20, color: 'rgba(255,255,255,0.75)', marginBottom: 32 }}>{conf.sub}</p>
        <button
          onClick={() => setMode('welcome')}
          style={{
            padding: '16px 48px', borderRadius: 14, border: 'none',
            background: 'linear-gradient(135deg, #FF6B35, #FF8C5A)',
            color: '#fff', fontSize: 18, fontWeight: 700, cursor: 'pointer'
          }}
        >
          Done
        </button>
      </div>
    );
  }

  // ─── WELCOME MODE ───
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      textAlign: 'center', zIndex: 1, maxWidth: 600
    }}>
      {/* Logo */}
      <div style={{
        width: 120, height: 120, borderRadius: 30,
        background: 'linear-gradient(135deg, #0D7377, #14FFEC)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 40, boxShadow: '0 20px 60px rgba(13, 115, 119, 0.4)',
        fontSize: 60, fontWeight: 800, color: '#fff'
      }}>
        S
      </div>

      <h1 style={{
        fontSize: 52, fontWeight: 800, color: '#fff',
        marginBottom: 8, letterSpacing: '-0.02em'
      }}>
        Welcome
      </h1>
      <p style={{
        fontSize: 20, color: 'rgba(255,255,255,0.7)',
        marginBottom: 48
      }}>
        Please select an option to continue
      </p>

      {/* Action Buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 400, maxWidth: '90vw' }}>
        <button
          onClick={() => navigate(`/kiosk/sign-in?org=${orgId}`)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
            padding: '26px 40px', borderRadius: 20,
            background: 'linear-gradient(135deg, #FF6B35, #FF8C5A)',
            border: 'none', color: '#fff', cursor: 'pointer',
            fontSize: 24, fontWeight: 700,
            boxShadow: '0 12px 40px rgba(255, 107, 53, 0.4)'
          }}
        >
          <LogIn size={32} />
          Sign In
          <ArrowRight size={28} />
        </button>

        <button
          onClick={() => setMode('scan')}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
            padding: '22px 40px', borderRadius: 20,
            background: 'linear-gradient(135deg, #0D7377, #14919B)',
            border: 'none', color: '#fff', cursor: 'pointer',
            fontSize: 22, fontWeight: 700,
            boxShadow: '0 12px 40px rgba(13, 115, 119, 0.4)'
          }}
        >
          <QrCode size={30} />
          Scan QR to Check In
        </button>

        <button
          onClick={() => navigate(`/kiosk/sign-out?org=${orgId}`)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
            padding: '22px 40px', borderRadius: 20,
            background: 'rgba(255,255,255,0.1)',
            border: '2px solid rgba(255,255,255,0.3)',
            color: '#fff', cursor: 'pointer',
            fontSize: 22, fontWeight: 600,
            backdropFilter: 'blur(10px)'
          }}
        >
          <LogOut size={30} />
          Sign Out
        </button>
      </div>

      <p style={{
        marginTop: 40, fontSize: 14, color: 'rgba(255,255,255,0.4)'
      }}>
        Powered by Sentinels Sign-In
      </p>
    </div>
  );
}
