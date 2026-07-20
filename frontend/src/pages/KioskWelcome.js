import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, LogIn, LogOut, QrCode, CheckCircle, XCircle, PenLine } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import api from '../utils/api';
import SignaturePad from '../components/SignaturePad';

// Same fallback as the backend — used when NDA is on but no custom text is saved yet.
const DEFAULT_NDA_TEXT = `VISITOR NON-DISCLOSURE AGREEMENT

By signing below, the visitor agrees to keep confidential all non-public information, materials, and activities observed or accessed while on these premises.

The visitor agrees not to disclose, copy, photograph, record, or share any such information with any third party, and to follow all site safety and security rules for the duration of the visit.

This agreement takes effect upon signing and remains in effect after the visit ends.`;

export default function KioskWelcome() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Org ID from URL param, or remembered from a previous visit on this device
  const orgId = searchParams.get('org') || localStorage.getItem('kiosk_org_id');

  // mode: welcome | scan | done | already | error
  const [mode, setMode] = useState('welcome');
  const [pairedName, setPairedName] = useState(() => localStorage.getItem('kiosk_device_name') || '');
  const [showPair, setShowPair] = useState(false);
  const [pairCode, setPairCode] = useState('');
  const [pairBusy, setPairBusy] = useState(false);
  const [pairError, setPairError] = useState('');
  const [result, setResult] = useState(null);
  // pairFlow: null | 'pairing' | 'paired' | 'error'
  const [pairFlow, setPairFlow] = useState(null);
  const [pairFlowMsg, setPairFlowMsg] = useState('');
  // NDA signing for pre-registered visitors (when the org requires it)
  const [ndaRequired, setNdaRequired] = useState(false);
  const [ndaText, setNdaText] = useState('');
  const [logoData, setLogoData] = useState('');
  const [pendingVisitor, setPendingVisitor] = useState(null);
  const [ndaSig, setNdaSig] = useState(null);
  const [ndaName, setNdaName] = useState('');
  const [ndaBusy, setNdaBusy] = useState(false);
  const scannerRef = useRef(null);
  const processingRef = useRef(false);
  const pairAttemptedRef = useRef(false);
  const ndaRequiredRef = useRef(false); // read inside the scanner callback (avoids stale closure)

  useEffect(() => {
    if (orgId) {
      localStorage.setItem('kiosk_org_id', orgId);
    }
  }, [orgId]);

  // Load org kiosk config (NDA requirement, branding) once we know the org
  useEffect(() => {
    if (!orgId) return;
    api.get(`/kiosk/config/${orgId}`).then(r => {
      setNdaRequired(!!r.data.nda_required);
      ndaRequiredRef.current = !!r.data.nda_required;
      setNdaText(r.data.nda_text || '');
      setLogoData(r.data.logo_data || '');
    }).catch(() => {});
  }, [orgId]);

  // ─── DEVICE PAIRING (declared before any early returns that reference them) ───
  const submitPair = async () => {
    if (!pairCode.trim()) return;
    setPairBusy(true);
    setPairError('');
    try {
      const r = await api.post('/devices/pair', { code: pairCode.trim().toUpperCase() });
      localStorage.setItem('kiosk_device_id', r.data.device_id);
      localStorage.setItem('kiosk_device_name', r.data.device_name);
      if (r.data.org_id) localStorage.setItem('kiosk_org_id', r.data.org_id);
      setPairedName(r.data.device_name);
      setShowPair(false);
      setPairCode('');
    } catch (err) {
      setPairError(err.response?.data?.error || 'Pairing failed — check the code');
    } finally {
      setPairBusy(false);
    }
  };

  const unpair = () => {
    localStorage.removeItem('kiosk_device_id');
    localStorage.removeItem('kiosk_device_name');
    setPairedName('');
  };

  // Pre-registered visitor check-in, with or without a signed NDA
  const completePreregCheckin = async (visitor, nda) => {
    try {
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
        sign_in_method: 'qr_code',
        ...(nda ? { nda_signature: nda.signature, nda_signed_name: nda.name } : {})
      });
      setResult({ name: visitor.first_name, badge: r.data?.badge_number });
      setMode(r.data?.already_checked_in ? 'already' : 'done');
      setTimeout(() => setMode('welcome'), 6000);
    } catch (err) {
      setResult({ message: err.response?.data?.error || 'Invalid or expired QR code' });
      setMode('error');
    }
  };

  // ─── MAGIC-LINK PAIRING: /kiosk?pair=ABC123 pairs this device automatically ───
  useEffect(() => {
    const code = searchParams.get('pair');
    if (!code || pairAttemptedRef.current) return;
    pairAttemptedRef.current = true;

    const doPair = async () => {
      setPairFlow('pairing');
      try {
        const r = await api.post('/devices/pair', { code: code.trim().toUpperCase() });
        localStorage.setItem('kiosk_device_id', r.data.device_id);
        localStorage.setItem('kiosk_device_name', r.data.device_name);
        if (r.data.org_id) localStorage.setItem('kiosk_org_id', r.data.org_id);
        setPairedName(r.data.device_name);
        setPairFlowMsg(r.data.device_name);
        setPairFlow('paired');
      } catch (err) {
        setPairFlowMsg(err.response?.data?.error || 'Pairing failed — check the link or code');
        setPairFlow('error');
      }
      // Clean the code out of the URL, keep org context
      const cleanOrg = localStorage.getItem('kiosk_org_id');
      window.history.replaceState({}, '', cleanOrg ? `/kiosk?org=${cleanOrg}` : '/kiosk');
      setTimeout(() => setPairFlow(null), 5000);
    };
    doPair();
  }, [searchParams]);

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

      // Staff badge QR (printed employee ID cards)
      if (token.startsWith('STAFF:')) {
        try {
          const r = await api.post('/visits/staff-checkin', { org_id: orgId, host_id: token.slice(6) });
          setResult({ name: r.data.name, badge: r.data.badge });
          setMode(r.data.action === 'checked_in' ? 'done' : 'bye');
          setTimeout(() => setMode('welcome'), 6000);
        } catch (err) {
          setResult({ message: err.response?.data?.error || 'Badge not recognized for this kiosk' });
          setMode('error');
        }
        return;
      }

      try {
        const v = await api.get(`/pre-registered/validate-qr/${token}`);
        const visitor = v.data.visitor;
        if (visitor.org_id !== orgId) {
          setResult({ name: `${visitor.first_name} ${visitor.last_name}` });
          setMode('error');
          return;
        }
        // NDA required? Pause here and ask the visitor to sign before checking in
        if (ndaRequiredRef.current) {
          setPendingVisitor(visitor);
          setNdaSig(null);
          setNdaName(`${visitor.first_name} ${visitor.last_name}`.trim());
          setMode('nda');
          return;
        }
        await completePreregCheckin(visitor, null);
      } catch (err) {
        setResult({ message: err.response?.data?.error || 'Invalid or expired QR code' });
        setMode('error');
      }
    };

    // Front camera first — visitors hold their phone up to the screen, so the
    // selfie camera is the right one. Fall back to any camera if none exists.
    const scanConfig = { fps: 10, qrbox: { width: 260, height: 260 } };
    scanner
      .start({ facingMode: 'user' }, scanConfig, onScan, () => {})
      .catch(() => scanner.start({ facingMode: 'environment' }, scanConfig, onScan, () => {}))
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
  if (!orgId && !pairFlow) {
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
          padding: '24px', border: '1px solid rgba(255,255,255,0.2)',
          width: '100%', maxWidth: 400
        }}>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.8)', marginBottom: 14, fontWeight: 600 }}>
            Pair this kiosk to set it up
          </p>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', marginBottom: 16 }}>
            Scan the pairing QR from <strong style={{ color: 'rgba(255,255,255,0.85)' }}>Dashboard → Devices</strong>,
            or enter the 6-character pairing code:
          </p>
          <input
            type="text" value={pairCode}
            onChange={(e) => setPairCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
            onKeyDown={(e) => { if (e.key === 'Enter') submitPair(); }}
            placeholder="ABC123"
            style={{
              width: '100%', padding: '14px', borderRadius: 12, border: '2px solid rgba(20,255,236,0.4)',
              background: 'rgba(0,0,0,0.3)', color: '#14FFEC', fontSize: 26, fontWeight: 800,
              textAlign: 'center', letterSpacing: 8, fontFamily: 'monospace', outline: 'none', marginBottom: 12
            }}
          />
          {pairError && <div style={{ fontSize: 13, color: '#FCA5A5', marginBottom: 10 }}>{pairError}</div>}
          <button onClick={submitPair} disabled={pairBusy || pairCode.length < 6}
            style={{
              width: '100%', padding: '14px', borderRadius: 12, border: 'none',
              background: pairCode.length < 6 ? 'rgba(13,115,119,0.4)' : '#0D7377',
              color: '#fff', fontSize: 16, fontWeight: 700, cursor: pairCode.length < 6 ? 'not-allowed' : 'pointer'
            }}>
            {pairBusy ? 'Pairing…' : 'Pair Kiosk'}
          </button>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 14, marginBottom: 0 }}>
            No code yet? Ask your admin to add this kiosk under Dashboard → Devices.
          </p>
        </div>
      </div>
    );
  }

  // ─── SCAN MODE ───
  // ─── PAIRING IN PROGRESS / RESULT ───
  if (pairFlow) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg, #0F172A 0%, #0D7377 100%)', color: '#fff', padding: 24, textAlign: 'center'
      }}>
        {pairFlow === 'pairing' && (
          <>
            <div style={{
              width: 64, height: 64, border: '5px solid rgba(255,255,255,0.2)', borderTopColor: '#14FFEC',
              borderRadius: '50%', animation: 'spin 0.9s linear infinite', marginBottom: 28
            }} />
            <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
            <h1 style={{ fontSize: 28, fontWeight: 800 }}>Pairing this kiosk…</h1>
          </>
        )}
        {pairFlow === 'paired' && (
          <>
            <CheckCircle size={72} color="#14FFEC" style={{ marginBottom: 24 }} />
            <h1 style={{ fontSize: 32, fontWeight: 800, marginBottom: 8 }}>Kiosk Paired!</h1>
            <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.75)' }}>This device is now <strong>{pairFlowMsg}</strong></p>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginTop: 12 }}>Bookmark or add this page to the home screen — you're all set.</p>
          </>
        )}
        {pairFlow === 'error' && (
          <>
            <XCircle size={72} color="#FCA5A5" style={{ marginBottom: 24 }} />
            <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>Pairing Failed</h1>
            <p style={{ fontSize: 16, color: '#FCA5A5' }}>{pairFlowMsg}</p>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginTop: 12 }}>Ask your admin for a new pairing link or QR code.</p>
          </>
        )}
      </div>
    );
  }

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

  // ─── NDA SIGNING (pre-registered visitor, org requires NDA) ───
  if (mode === 'nda' && pendingVisitor) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 1, maxWidth: 620, width: '100%', padding: '0 16px' }}>
        <PenLine size={40} color="#14FFEC" style={{ marginBottom: 12 }} />
        <h1 style={{ fontSize: 32, fontWeight: 800, color: '#fff', marginBottom: 6, textAlign: 'center' }}>
          One more step, {pendingVisitor.first_name}
        </h1>
        <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.7)', marginBottom: 20, textAlign: 'center' }}>
          Please read and sign the agreement below to complete your check-in
        </p>

        <div style={{
          width: '100%', background: 'rgba(255,255,255,0.95)', borderRadius: 14,
          padding: '18px 20px', maxHeight: 180, overflowY: 'auto',
          color: '#1E293B', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap',
          marginBottom: 18, textAlign: 'left'
        }}>
          {ndaText || DEFAULT_NDA_TEXT}
        </div>

        <div style={{ width: '100%', marginBottom: 16 }}>
          <SignaturePad onChange={setNdaSig} height={160} />
        </div>

        <input
          type="text" value={ndaName}
          onChange={(e) => setNdaName(e.target.value)}
          placeholder="Type your full legal name"
          style={{
            width: '100%', padding: '14px 18px', borderRadius: 12, marginBottom: 16,
            border: '2px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.1)',
            color: '#fff', fontSize: 17, outline: 'none'
          }}
        />

        <div style={{ display: 'flex', gap: 12, width: '100%' }}>
          <button
            onClick={() => { setPendingVisitor(null); setMode('welcome'); }}
            style={{
              flex: 1, padding: '16px', borderRadius: 14,
              background: 'rgba(255,255,255,0.1)', border: '2px solid rgba(255,255,255,0.3)',
              color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer'
            }}
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              setNdaBusy(true);
              await completePreregCheckin(pendingVisitor, { signature: ndaSig, name: ndaName });
              setNdaBusy(false);
              setPendingVisitor(null);
            }}
            disabled={ndaBusy || !ndaSig || !ndaName.trim()}
            style={{
              flex: 2, padding: '16px', borderRadius: 14, border: 'none',
              background: (ndaBusy || !ndaSig || !ndaName.trim()) ? 'rgba(255,107,53,0.35)' : 'linear-gradient(135deg, #FF6B35, #FF8C5A)',
              color: '#fff', fontSize: 17, fontWeight: 700,
              cursor: (ndaBusy || !ndaSig || !ndaName.trim()) ? 'not-allowed' : 'pointer'
            }}
          >
            {ndaBusy ? 'Checking in…' : 'Sign & Check In'}
          </button>
        </div>
      </div>
    );
  }

  // ─── SUCCESS / ALREADY / ERROR SCREENS ───
  if (mode === 'done' || mode === 'already' || mode === 'error' || mode === 'bye') {
    const conf = {
      done:    { icon: <CheckCircle size={90} color="#2ECC71" />, title: `Welcome, ${result?.name || 'visitor'}!`, sub: result?.badge ? `Your badge: ${result.badge}` : "You're checked in" },
      already: { icon: <CheckCircle size={90} color="#14FFEC" />, title: 'Already checked in', sub: result?.badge ? `Active badge: ${result.badge}` : 'Your visit is already active' },
      bye:     { icon: <LogOut size={90} color="#14FFEC" />, title: `Goodbye, ${result?.name || ''}!`, sub: "You're checked out. Have a great day!" },
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
      {/* Logo — org's uploaded logo when available, otherwise the default mark */}
      {logoData ? (
        <img src={logoData} alt="Organization logo" style={{
          width: 120, height: 120, borderRadius: 30, objectFit: 'contain',
          background: 'rgba(255,255,255,0.95)', padding: 10,
          marginBottom: 40, boxShadow: '0 20px 60px rgba(13, 115, 119, 0.4)'
        }} />
      ) : (
        <div style={{
          width: 120, height: 120, borderRadius: 30,
          background: 'linear-gradient(135deg, #0D7377, #14FFEC)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 40, boxShadow: '0 20px 60px rgba(13, 115, 119, 0.4)',
          fontSize: 60, fontWeight: 800, color: '#fff'
        }}>
          S
        </div>
      )}

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

      {/* Device pairing */}
      <div style={{ marginTop: 14, minHeight: 40 }}>
        {!showPair && !pairedName && (
          <button onClick={() => setShowPair(true)}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}>
            Pair this kiosk
          </button>
        )}
        {!showPair && pairedName && (
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>
            ● {pairedName}{' '}
            <button onClick={unpair} title="Unpair this device"
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline', marginLeft: 6 }}>
              unpair
            </button>
          </div>
        )}
        {showPair && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 16, padding: 18, backdropFilter: 'blur(10px)'
          }}>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.75)' }}>Enter the pairing code from Dashboard → Devices:</div>
            <input
              type="text" value={pairCode} autoFocus
              onChange={(e) => setPairCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              onKeyDown={(e) => { if (e.key === 'Enter') submitPair(); }}
              placeholder="ABC123"
              style={{
                width: 200, padding: '12px', borderRadius: 12, border: '2px solid rgba(20,255,236,0.4)',
                background: 'rgba(0,0,0,0.3)', color: '#14FFEC', fontSize: 24, fontWeight: 800,
                textAlign: 'center', letterSpacing: 8, fontFamily: 'monospace', outline: 'none'
              }}
            />
            {pairError && <div style={{ fontSize: 13, color: '#FCA5A5' }}>{pairError}</div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setShowPair(false); setPairCode(''); setPairError(''); }}
                style={{ padding: '10px 20px', borderRadius: 10, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', fontSize: 14, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={submitPair} disabled={pairBusy || pairCode.length < 6}
                style={{ padding: '10px 24px', borderRadius: 10, background: pairCode.length < 6 ? 'rgba(13,115,119,0.4)' : '#0D7377', border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, cursor: pairCode.length < 6 ? 'not-allowed' : 'pointer' }}>
                {pairBusy ? 'Pairing…' : 'Pair'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
