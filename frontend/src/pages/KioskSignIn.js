import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Building, User, Mail, Phone, Car, FileText, Search, ChevronDown, X, Camera, PenLine , ScanFace, Printer } from 'lucide-react';
import api from '../utils/api';
import useRfidTap from '../utils/useRfidTap';
import { getTerms } from '../utils/terms';
import { printBadge } from '../utils/badge';
import SignaturePad from '../components/SignaturePad';

// Shown when the org requires an NDA but hasn't written their own text yet.
// Keep in sync with DEFAULT_NDA_TEXT in backend/src/routes/visits.js.
const DEFAULT_NDA_TEXT = `VISITOR NON-DISCLOSURE AGREEMENT

By signing below, the visitor agrees to keep confidential all non-public information, materials, and activities observed or accessed while on these premises.

The visitor agrees not to disclose, copy, photograph, record, or share any such information with any third party, and to follow all site safety and security rules for the duration of the visit.

This agreement takes effect upon signing and remains in effect after the visit ends.`;

export default function KioskSignIn() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Must be declared BEFORE any useEffect that references it (was declared below -> TDZ crash -> white screen)
  const orgId = searchParams.get('org') || localStorage.getItem('kiosk_org_id');
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [hosts, setHosts] = useState([]);
  const [visitorTypes, setVisitorTypes] = useState([]);
  const [formData, setFormData] = useState({
    first_name: '', last_name: '', email: '', phone: '',
    company: '', host_id: '', visitor_type_id: '', visitor_type_name: '',
    purpose: '', vehicle_plate: '',
  });
  const [visitResult, setVisitResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  // ID scan (OCR) — admin enables it in Settings → Front Desk & Integrations
  const [showScan, setShowScan] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState('');
  const [visitorDob, setVisitorDob] = useState(null);
  const openScan = async () => {
    setShowScan(true);
    setScanError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (e) {
      setScanError('Camera not available — you can upload a photo of the ID instead.');
    }
  };
  const closeScan = () => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setShowScan(false);
  };
  const runScan = async (dataUrl) => {
    setScanBusy(true);
    setScanError('');
    try {
      const r = await api.post('/kiosk/scan-id', { org_id: orgId, image: dataUrl });
      const d = r.data || {};
      let filled = [];
      setFormData(prev => ({
        ...prev,
        first_name: d.first_name || prev.first_name,
        last_name: d.last_name || prev.last_name,
      }));
      if (d.first_name) filled.push('first name');
      if (d.last_name) filled.push('last name');
      if (d.dob) { setVisitorDob(d.dob); filled.push('date of birth'); }
      closeScan();
      if (filled.length > 0) {
        setScanError('');
        setOcrNotice(`From the ID: ${filled.join(', ')} — please check it's correct.`);
      } else {
        setOcrNotice('Could not read the ID clearly — please type the details.');
      }
    } catch (e) {
      setScanError(e.response?.data?.error || 'Could not scan the ID — try again or type the details.');
    } finally {
      setScanBusy(false);
    }
  };
  const captureScan = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) { setScanError('Camera not ready yet — one moment…'); return; }
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    runScan(c.toDataURL('image/jpeg', 0.85));
  };
  const uploadScan = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => runScan(reader.result);
    reader.readAsDataURL(f);
  };
  const [ocrNotice, setOcrNotice] = useState('');
  const [idScanEnabled, setIdScanEnabled] = useState(false);
  const [profileAnswers, setProfileAnswers] = useState({}); // industry-specific fields (unit #, student…)

  // Per-field validation — the kiosk is public, so garbage in = garbage in the visitor log
  const [fieldErrors, setFieldErrors] = useState({});
  const NAME_RE = /^[\p{L}][\p{L}\s.'-]{0,99}$/u;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const PHONE_RE = /^[+()\-\.\s\d]{7,20}$/;

  const updateField = (key, value) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };
  const errText = (key) => fieldErrors[key] ? (
    <div style={{ color: '#FCA5A5', fontSize: 13, marginTop: 6 }}>{fieldErrors[key]}</div>
  ) : null;
  const errBorder = (key) => fieldErrors[key] ? { border: '2px solid rgba(239,68,68,0.8)' } : {};

  const validateStep1 = () => {
    const e = {};
    const fn = formData.first_name.trim(), ln = formData.last_name.trim();
    if (fn.length < 2 || !NAME_RE.test(fn)) e.first_name = 'Letters only, at least 2 characters';
    if (ln.length < 2 || !NAME_RE.test(ln)) e.last_name = 'Letters only, at least 2 characters';
    const em = formData.email.trim();
    if (em && !EMAIL_RE.test(em)) e.email = "That email doesn't look valid — fix it or leave it empty";
    const ph = formData.phone.trim();
    if (ph && (!PHONE_RE.test(ph) || (ph.match(/\d/g) || []).length < 7)) e.phone = "That phone number doesn't look valid — fix it or leave it empty";
    // Date of birth (hospital profile): a present value must be a real calendar
    // date, after 1900 and not in the future — typed or scanned
    const dobVal = visitorDob || String(profileAnswers.dob || '').trim();
    if (dobVal) {
      const m = dobVal.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      let bad = !m;
      if (m) {
        const y = +m[1], mo = +m[2], d = +m[3];
        const dt = new Date(y, mo - 1, d);
        bad = dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d
           || y < 1900 || dt.getTime() > Date.now();
      }
      if (bad) e.dob = 'Enter a real date of birth — it cannot be in the future';
    }
    setFieldErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateStep2 = () => {
    const e = {};
    if (formData.purpose.trim().length > 300) e.purpose = 'Please keep it under 300 characters';
    const vp = formData.vehicle_plate.trim();
    if (vp && !/^[A-Za-z0-9\s-]{2,20}$/.test(vp)) e.vehicle_plate = 'Letters, numbers and dashes only';
    setFieldErrors(e);
    return Object.keys(e).length === 0;
  };
  const [done, setDone] = useState(false);

  // NDA signing (org-configurable)
  const [ndaRequired, setNdaRequired] = useState(false);
  const [ndaText, setNdaText] = useState('');
  const [ndaSig, setNdaSig] = useState(null);
  const [ndaName, setNdaName] = useState('');

  // Organization profile terminology (tenants / employees / doctors…)
  const [terms, setTerms] = useState(getTerms('other'));

  // Custom registration fields (org-configurable, Settings → Registration Form)
  const [customFields, setCustomFields] = useState([]);
  const [customData, setCustomData] = useState({});
  // Standard fields the org hid (Settings → Registration Form) — name/host/type never hide
  const [hiddenFields, setHiddenFields] = useState([]);
  const fieldShown = (key) => !hiddenFields.includes(key);

  // Photo capture (org-configurable)
  const [photoRequired, setPhotoRequired] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [cameraOn, setCameraOn] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    if (!orgId) return;
    const loadConfig = () => api.get(`/kiosk/config/${orgId}`).then(r => {
      setPhotoRequired(!!r.data.photo_required);
      setNdaRequired(!!r.data.nda_required);
      setNdaText(r.data.nda_text || '');
      const cf = Array.isArray(r.data.custom_fields) ? r.data.custom_fields : [];
      setCustomFields(cf);
      setHiddenFields(Array.isArray(r.data.hidden_fields) ? r.data.hidden_fields : []);
      setTerms(getTerms(r.data.profile_type));
      setIdScanEnabled(!!r.data.id_scan_enabled);
      // pre-fill checkbox defaults (keep any values the visitor already typed)
      setCustomData(prev => {
        const next = { ...prev };
        cf.forEach(f => { if (f.type === 'checkbox' && next[f.label] === undefined) next[f.label] = false; });
        return next;
      });
    }).catch(() => {});
    loadConfig();
    // Admins edit the registration form while the kiosk is running — pick changes
    // up fast (30s) and immediately when the tablet screen comes back to the tab
    const t = setInterval(loadConfig, 30 * 1000);
    const onVisible = () => { if (document.visibilityState === 'visible') loadConfig(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [orgId]);

  // ─── IDLE RESET: an abandoned half-filled form leaks the previous visitor's
  // details (name, email, photo) to the next person. After 60s of no interaction
  // we warn; at 90s we clear everything and return to the welcome screen.
  const [idleWarn, setIdleWarn] = useState(false);
  const idleWarnRef = useRef(null);
  const idleTimerRef = useRef(null);
  useEffect(() => {
    if (!orgId || done) return;
    const arm = () => {
      clearTimeout(idleWarnRef.current);
      clearTimeout(idleTimerRef.current);
      setIdleWarn(false);
      idleWarnRef.current = setTimeout(() => setIdleWarn(true), 60000);
      idleTimerRef.current = setTimeout(() => navigate(`/kiosk?org=${orgId}`), 90000);
    };
    arm();
    window.addEventListener('pointerdown', arm);
    window.addEventListener('keydown', arm);
    return () => {
      clearTimeout(idleWarnRef.current);
      clearTimeout(idleTimerRef.current);
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, done]);

  // Successful sign-in screen: auto-return to welcome after 10s so the next
  // person never sees the previous visitor's name/badge
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => navigate(`/kiosk?org=${orgId}`), 10000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  // ─── RFID tap on this screen: staff/FV badges sign in (or out) without
  // touching the visitor form — whatever was typed stays exactly as it was
  const [rfidResult, setRfidResult] = useState(null); // { name, action } | { error }
  const rfidTimerRef = useRef(null);
  const handleRfidTap = async (uid) => {
    try {
      const r = await api.post('/visits/rfid-tap', { org_id: orgId, uid, device_id: localStorage.getItem('kiosk_device_id') || undefined, });
      setRfidResult({ name: r.data.name, action: r.data.action, badge: r.data.badge, photo: r.data.photo });
    } catch (err) {
      setRfidResult({ error: err.response?.data?.error || 'Card not recognized for this kiosk' });
    }
    clearTimeout(rfidTimerRef.current);
    rfidTimerRef.current = setTimeout(() => setRfidResult(null), 6000);
  };
  useRfidTap(handleRfidTap, { enabled: !!orgId && !done });

  const rfidOverlay = rfidResult && (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(15,23,42,0.85)', backdropFilter: 'blur(8px)', padding: 24
    }} onClick={() => setRfidResult(null)}>
      <div style={{ textAlign: 'center', maxWidth: 480 }}>
        {rfidResult.error ? (
          <>
            <div style={{
              width: 90, height: 90, borderRadius: '50%', margin: '0 auto 20px',
              background: 'rgba(239,68,68,0.2)', border: '3px solid rgba(239,68,68,0.6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 40, color: '#FCA5A5'
            }}>✕</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#FCA5A5' }}>{rfidResult.error}</div>
          </>
        ) : (
          <>
            {rfidResult.photo ? (
              <img src={rfidResult.photo} alt="" style={{
                width: 130, height: 130, borderRadius: '50%', objectFit: 'cover', marginBottom: 20,
                border: `4px solid ${rfidResult.action === 'checked_in' ? '#2ECC71' : '#14FFEC'}`
              }} />
            ) : (
              <div style={{
                width: 130, height: 130, borderRadius: '50%', margin: '0 auto 20px',
                background: 'linear-gradient(135deg, #0D7377, #14FFEC)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 52, fontWeight: 800, color: '#fff',
                border: `4px solid ${rfidResult.action === 'checked_in' ? '#2ECC71' : '#14FFEC'}`
              }}>
                {rfidResult.name?.[0] || '?'}
              </div>
            )}
            <div style={{ fontSize: 34, fontWeight: 800, color: '#fff', marginBottom: 8 }}>
              {rfidResult.action === 'checked_in' ? `Welcome, ${rfidResult.name}!` : `Goodbye, ${rfidResult.name}!`}
            </div>
            <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.7)' }}>
              {rfidResult.action === 'checked_in'
                ? (rfidResult.badge ? `Badge: ${rfidResult.badge}` : "You're signed in")
                : "You're signed out. Have a great day!"}
            </div>
          </>
        )}
      </div>
    </div>
  );

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCameraOn(false);
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640 } });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraOn(true);
    } catch (e) { /* camera unavailable */ }
  };

  useEffect(() => {
    if (step === 1 && photoRequired && !photo) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [step, photoRequired, photo]);

  const takePhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 480 / video.videoWidth);
    canvas.width = video.videoWidth * scale;
    canvas.height = video.videoHeight * scale;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    setPhoto(canvas.toDataURL('image/jpeg', 0.7));
    stopCamera();
  };

  // Host dropdown state
  const [hostSearch, setHostSearch] = useState('');
  const [showHostDropdown, setShowHostDropdown] = useState(false);
  const [selectedHost, setSelectedHost] = useState(null);
  const hostDropdownRef = useRef(null);

  React.useEffect(() => {
    if (orgId) {
      localStorage.setItem('kiosk_org_id', orgId);
    }
  }, [orgId]);

  React.useEffect(() => {
    if (!orgId) return;

    const loadLists = () => {
      api.get(`/hosts/public/${orgId}`).then(r => {
        if (r.data && r.data.length > 0) setHosts(r.data);
      }).catch(() => {});
      api.get(`/visitor-types/public/${orgId}`).then(r => {
        setVisitorTypes(Array.isArray(r.data) ? r.data : []);
      }).catch(() => {});
    };
    loadLists();
    const t = setInterval(loadLists, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [orgId]);

  // Types the kiosk shows: the org's own editable types (Settings → Visitor
  // Types) when they exist, otherwise sensible suggestions for the industry —
  // a hospital gets Patient / Family Member, not Guest / Interview. Fallback
  // types have id null so check-ins never send a fake uuid to the FK column.
  const displayTypes = visitorTypes.length > 0
    ? visitorTypes
    : (terms.defaultTypes || []).map(t => ({ id: null, name: t.name, badge_color: t.color }));

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (hostDropdownRef.current && !hostDropdownRef.current.contains(event.target)) {
        setShowHostDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  const totalSteps = ndaRequired ? 3 : 2;

  const idleBanner = idleWarn && (
    <div style={{
      position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 999,
      background: 'rgba(217,119,6,0.95)', color: '#fff', padding: '14px 26px', borderRadius: 14,
      fontSize: 16, fontWeight: 700, boxShadow: '0 10px 40px rgba(0,0,0,0.4)', textAlign: 'center'
    }}>
      For privacy, this form will clear in 30 seconds — touch anywhere to continue
    </div>
  );

  // Industry fields render on step 1 → they gate Continue.
  const industryRequiredMissing = (terms.kioskFields || []).some(f => f.required && !String(profileAnswers[f.key] || '').trim());
  // Org custom fields render on step 2 → they gate the final submit.
  // (Never gate a step with fields the visitor can't see yet — that deadlocks the form.)
  const customRequiredMissing = customFields.some(f => {
    if (!f.required) return false;
    const v = customData[f.label];
    return f.type === 'checkbox' ? !v : !v || !String(v).trim();
  });

  // Prints the visitor badge via the shared builder (utils/badge.js) — it waits
  // for the photo to decode before printing so badges never come out half-blank.
  // The kiosk browser's default printer is used — enable silent/kiosk-mode printing
  // (Chrome --kiosk-printing) on unattended kiosks for zero-dialog printing.
  const printVisitorBadge = (data) => {
    const v = (data && data.visit) || {};
    printBadge({
      title: 'VISITOR',
      firstName: formData.first_name,
      lastName: formData.last_name,
      company: formData.company,
      hostName: selectedHost ? `${selectedHost.first_name} ${selectedHost.last_name}` : '',
      hostLabel: 'Visiting',
      badgeNo: (data && data.badge_number) || v.badge_number || '',
      photo,
    });
  };

  const handleSubmit = async () => {
    if (!validateStep2()) return;
    setLoading(true);
    setErrorMsg('');
    try {
      // Industry fields: DOB maps to the visit's visitor_dob column; the rest
      // ride along as labelled custom_data entries
      const pf = terms.kioskFields || [];
      const dobField = pf.find(f => f.key === 'dob');
      const dobValue = visitorDob || (dobField && profileAnswers.dob) || undefined;
      const profileCustom = {};
      pf.forEach(f => {
        if (f.key !== 'dob' && String(profileAnswers[f.key] || '').trim()) profileCustom[f.label] = profileAnswers[f.key];
      });
      const mergedCustom = { ...profileCustom, ...customData };

      const res = await api.post('/visits/check-in', {
        org_id: orgId,
        device_id: localStorage.getItem('kiosk_device_id') || undefined,
        ...(dobValue ? { visitor_dob: dobValue } : {}),
        ...formData,
        // Hidden fields submit as NULL, never "" — an empty string crashes the
        // uuid columns (host_id / visitor_type_id) with "invalid input syntax"
        host_id: formData.host_id || null,
        visitor_type_id: formData.visitor_type_id || null,
        visitor_type_name: formData.visitor_type_name || undefined,
        sign_in_method: 'kiosk',
        photo_data: photo,
        custom_data: Object.keys(mergedCustom).length > 0 ? mergedCustom : undefined,
        nda_signature: ndaRequired ? ndaSig : undefined,
        nda_signed_name: ndaRequired ? ndaName : undefined
      });
      setVisitResult(res.data);
      setDone(true);
      // Auto-print the visitor badge when this kiosk has a printer linked
      // (Settings → Front Desk & Integrations + Devices → Link printer)
      if (res.data.print_badge) printVisitorBadge(res.data);
    } catch (err) {
      if (err.response?.data?.nda_required && ndaRequired) {
        setStep(3); // server still demands the NDA — send them to the signing step
      }
      setErrorMsg('Sign-in failed: ' + (err.response?.data?.error || 'Please try again'));
    } finally {
      setLoading(false);
    }
  };

  // Entering the NDA step: pre-fill the typed name from the form
  const goToNdaStep = () => {
    if (!validateStep2()) return;
    setErrorMsg('');
    if (!ndaName.trim()) {
      setNdaName(`${formData.first_name} ${formData.last_name}`.trim());
    }
    setStep(3);
  };

  const filteredHosts = hosts.filter(h => {
    const search = hostSearch.toLowerCase();
    return (
      h.first_name.toLowerCase().includes(search) ||
      h.last_name.toLowerCase().includes(search) ||
      (h.department && h.department.toLowerCase().includes(search)) ||
      (h.job_title && h.job_title.toLowerCase().includes(search))
    );
  });

  const selectHost = (host) => {
    setSelectedHost(host);
    setFormData({ ...formData, host_id: host.id });
    setHostSearch(`${host.first_name} ${host.last_name}`);
    setShowHostDropdown(false);
  };

  const clearHost = () => {
    setSelectedHost(null);
    setFormData({ ...formData, host_id: '' });
    setHostSearch('');
  };

  const inputStyle = {
    width: '100%', padding: '16px 20px', borderRadius: 14,
    border: '2px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.1)',
    color: '#fff', fontSize: 18, outline: 'none',
    backdropFilter: 'blur(10px)'
  };

  const labelStyle = {
    display: 'block', color: 'rgba(255,255,255,0.8)',
    fontSize: 14, fontWeight: 500, marginBottom: 8
  };

  if (done && visitResult) {
    return (
      <div style={{ textAlign: 'center', zIndex: 1 }}>
        {idleBanner}
        <div style={{
          width: 100, height: 100, borderRadius: '50%',
          background: '#2ECC71', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 30px', boxShadow: '0 10px 40px rgba(46, 204, 113, 0.4)'
        }}>
          <svg width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h2 style={{ fontSize: 42, fontWeight: 800, color: '#fff', marginBottom: 8 }}>
          You're Checked In!
        </h2>
        <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.7)', marginBottom: 40 }}>
          {formData.host_id && `Notifying your host...`}
        </p>

        {photo && (
          <img src={photo} alt="Visitor" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: '50%', border: '3px solid rgba(255,255,255,0.4)', marginBottom: 24 }} />
        )}

        <div style={{
          background: 'rgba(255,255,255,0.1)', borderRadius: 20,
          padding: '40px 60px', border: '2px solid rgba(255,255,255,0.2)',
          backdropFilter: 'blur(10px)', marginBottom: 40
        }}>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>
            Your Badge Number
          </div>
          <div style={{
            fontSize: 72, fontWeight: 800, color: '#14FFEC',
            letterSpacing: '0.1em', fontFamily: 'monospace'
          }}>
            {visitResult.badge_number}
          </div>
        </div>

        {/* Manual print — the safety net when auto-print didn't fire (printer not
            linked to this device, dialog dismissed, or paper jam) */}
        <button
          onClick={() => printVisitorBadge(visitResult)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 30,
            padding: '16px 28px', borderRadius: 14, fontSize: 17, fontWeight: 700,
            background: 'rgba(255,255,255,0.12)', color: '#fff', cursor: 'pointer',
            border: '2px solid rgba(255,255,255,0.3)'
          }}
        >
          <Printer size={20} /> Print Badge
        </button>

        <div style={{
          background: 'rgba(255,255,255,0.05)', borderRadius: 16,
          padding: 24, textAlign: 'left', marginBottom: 40
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ color: 'rgba(255,255,255,0.6)' }}>Name</span>
            <span style={{ color: '#fff', fontWeight: 600 }}>{formData.first_name} {formData.last_name}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ color: 'rgba(255,255,255,0.6)' }}>Time</span>
            <span style={{ color: '#fff', fontWeight: 600 }}>{new Date().toLocaleTimeString()}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'rgba(255,255,255,0.6)' }}>Date</span>
            <span style={{ color: '#fff', fontWeight: 600 }}>{new Date().toLocaleDateString()}</span>
          </div>
        </div>

        <button
          onClick={() => navigate(`/kiosk?org=${orgId}`)}
          style={{
            padding: '18px 60px', borderRadius: 16,
            background: 'rgba(255,255,255,0.1)', border: '2px solid rgba(255,255,255,0.3)',
            color: '#fff', fontSize: 18, fontWeight: 600, cursor: 'pointer'
          }}
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', maxWidth: 600, zIndex: 1 }}>
      {idleBanner}
      {rfidOverlay}

      {/* ID scan modal — camera or upload, OCR fills the form */}
      {showScan && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 950, background: 'rgba(2,6,23,0.92)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div style={{ background: '#0F172A', borderRadius: 24, padding: 24, width: '100%', maxWidth: 560, border: '1px solid rgba(20,255,236,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ color: '#fff', fontSize: 20, fontWeight: 800 }}>Scan your ID</div>
              <button onClick={closeScan} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 10, padding: 10, cursor: 'pointer' }}>
                <X size={18} color="#fff" />
              </button>
            </div>
            <div style={{ fontSize: 14, color: '#94A3B8', marginBottom: 14 }}>
              Hold the ID flat inside the frame, good lighting, no glare. We only read your name and date of birth — the photo is not stored.
            </div>
            <div style={{ borderRadius: 16, overflow: 'hidden', background: '#000', marginBottom: 14, minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', display: 'block' }} />
            </div>
            {scanError && (
              <div style={{ color: '#FCA5A5', fontSize: 14, marginBottom: 12, textAlign: 'center' }}>{scanError}</div>
            )}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={captureScan} disabled={scanBusy}
                style={{
                  flex: '1 1 200px', padding: '16px', borderRadius: 14, border: 'none',
                  background: scanBusy ? '#475569' : 'linear-gradient(135deg, #0D7377, #14FFEC)',
                  color: '#fff', fontSize: 16, fontWeight: 800, cursor: scanBusy ? 'wait' : 'pointer'
                }}>
                {scanBusy ? 'Reading ID…' : 'Capture & Read'}
              </button>
              <label style={{
                flex: '1 1 160px', padding: '16px', borderRadius: 14, textAlign: 'center',
                border: '2px solid rgba(255,255,255,0.2)', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer'
              }}>
                Upload photo
                <input type="file" accept="image/*" onChange={uploadScan} disabled={scanBusy} style={{ display: 'none' }} />
              </label>
            </div>
          </div>
        </div>
      )}
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
        <button
          onClick={() => step > 1 ? setStep(step - 1) : navigate(`/kiosk?org=${orgId}`)}
          style={{
            width: 48, height: 48, borderRadius: 14,
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer'
          }}
        >
          <ArrowLeft size={24} />
        </button>
        <div>
          <h2 style={{ fontSize: 28, fontWeight: 700, color: '#fff' }}>
            {step === 3 ? 'Sign the NDA' : 'Sign In'}
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>Step {step} of {totalSteps}</p>
        </div>
      </div>

      {/* Progress Bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 32 }}>
        {Array.from({ length: totalSteps }, (_, i) => i + 1).map(s => (
          <div key={s} style={{
            flex: 1, height: 4, borderRadius: 2,
            background: s <= step ? '#14FFEC' : 'rgba(255,255,255,0.2)',
            transition: 'background 0.3s'
          }} />
        ))}
      </div>

      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {fieldShown('visitor_type') && (
            <div>
              <label style={labelStyle}>I am a...</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {displayTypes.map(vt => (
                  <button
                    key={vt.id || vt.name}
                    onClick={() => setFormData({ ...formData, visitor_type_id: vt.id || null, visitor_type_name: vt.name })}
                    style={{
                      padding: '20px 16px', borderRadius: 14,
                      background: formData.visitor_type_name === vt.name ? vt.badge_color : 'rgba(255,255,255,0.1)',
                      border: `2px solid ${formData.visitor_type_name === vt.name ? vt.badge_color : 'rgba(255,255,255,0.2)'}`,
                      color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer',
                      textAlign: 'center'
                    }}
                  >
                    {vt.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {idScanEnabled && (
            <div style={{ marginBottom: 18 }}>
              <button type="button" onClick={openScan}
                style={{
                  width: '100%', padding: '16px', borderRadius: 14, border: '2px dashed rgba(20,255,236,0.5)',
                  background: 'rgba(20,255,236,0.08)', color: '#14FFEC', fontSize: 17, fontWeight: 700,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10
                }}>
                <ScanFace size={22} /> Scan your ID to fill this in
              </button>
              {ocrNotice && (
                <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 10, background: 'rgba(20,255,236,0.12)', color: '#A7F3D0', fontSize: 14, textAlign: 'center' }}>
                  {ocrNotice}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={labelStyle}><User size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />First Name</label>
              <input
                type="text" value={formData.first_name}
                onChange={(e) => updateField('first_name', e.target.value)}
                style={{ ...inputStyle, ...errBorder('first_name') }} placeholder="John"
              />
              {errText('first_name')}
            </div>
            <div>
              <label style={labelStyle}>Last Name</label>
              <input
                type="text" value={formData.last_name}
                onChange={(e) => updateField('last_name', e.target.value)}
                style={{ ...inputStyle, ...errBorder('last_name') }} placeholder="Doe"
              />
              {errText('last_name')}
            </div>
          </div>

          {/* Industry identity fields (Organization Profile — DOB for hospitals,
              unit # for buildings) live on step 1 with the rest of "who are you" */}
          {(terms.kioskFields || []).map((f) => (
            <div key={f.key}>
              <label style={labelStyle}>{f.label}{f.required ? ' *' : ''}</label>
              <input
                type={f.type === 'date' ? 'date' : 'text'}
                value={profileAnswers[f.key] || ''}
                onChange={(e) => setProfileAnswers({ ...profileAnswers, [f.key]: e.target.value })}
                style={inputStyle}
                placeholder={f.placeholder || f.label}
              />
              {f.key === 'dob' && errText('dob')}
            </div>
          ))}

          {fieldShown('email') && (
            <div>
              <label style={labelStyle}><Mail size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Email</label>
              <input
                type="email" value={formData.email}
                onChange={(e) => updateField('email', e.target.value)}
                style={{ ...inputStyle, ...errBorder('email') }} placeholder="john@company.com"
              />
              {errText('email')}
            </div>
          )}

          {fieldShown('phone') && (
            <div>
              <label style={labelStyle}><Phone size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Phone</label>
              <input
                type="tel" value={formData.phone}
                onChange={(e) => updateField('phone', e.target.value)}
                style={{ ...inputStyle, ...errBorder('phone') }} placeholder="(555) 123-4567"
              />
              {errText('phone')}
            </div>
          )}

          {fieldShown('company') && (
            <div>
              <label style={labelStyle}><Building size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Company</label>
              <input
                type="text" value={formData.company}
                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                style={inputStyle} placeholder="Acme Inc."
              />
            </div>
          )}

          {photoRequired && fieldShown('photo') && (
            <div>
              <label style={labelStyle}><Camera size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Photo</label>
              {photo ? (
                <div style={{ textAlign: 'center' }}>
                  <img src={photo} alt="Visitor" style={{ width: 160, height: 160, objectFit: 'cover', borderRadius: 16, border: '2px solid rgba(255,255,255,0.3)' }} />
                  <div>
                    <button onClick={() => setPhoto(null)} style={{ marginTop: 10, padding: '8px 16px', borderRadius: 10, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', cursor: 'pointer', fontSize: 14 }}>
                      Retake
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center' }}>
                  <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', maxWidth: 320, borderRadius: 16, background: '#000', border: '2px solid rgba(255,255,255,0.2)' }} />
                  <div>
                    <button onClick={takePhoto} disabled={!cameraOn} style={{ marginTop: 10, padding: '12px 24px', borderRadius: 12, background: cameraOn ? '#0D7377' : 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', fontWeight: 600, cursor: cameraOn ? 'pointer' : 'not-allowed', fontSize: 15 }}>
                      {cameraOn ? 'Take Photo' : 'Starting camera...'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {errorMsg && (
            <div style={{
              marginTop: 16, padding: '14px 18px', borderRadius: 12,
              background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.5)',
              color: '#FCA5A5', fontSize: 15, fontWeight: 500, textAlign: 'center'
            }} onClick={() => setErrorMsg('')}>
              {errorMsg}
            </div>
          )}

          <button
            onClick={() => { setErrorMsg(''); if (validateStep1()) setStep(2); }}
            disabled={!formData.first_name || !formData.last_name || (fieldShown('visitor_type') && !formData.visitor_type_name) || (photoRequired && fieldShown('photo') && !photo) || industryRequiredMissing}
            style={{
              marginTop: 20, padding: '20px', borderRadius: 16,
              background: (!formData.first_name || !formData.last_name || (fieldShown('visitor_type') && !formData.visitor_type_name) || (photoRequired && fieldShown('photo') && !photo) || industryRequiredMissing) ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, #FF6B35, #FF8C5A)',
              border: 'none', color: '#fff', fontSize: 20, fontWeight: 700,
              cursor: (!formData.first_name || !formData.last_name || (fieldShown('visitor_type') && !formData.visitor_type_name) || (photoRequired && fieldShown('photo') && !photo) || industryRequiredMissing) ? 'not-allowed' : 'pointer',
              opacity: (!formData.first_name || !formData.last_name || (fieldShown('visitor_type') && !formData.visitor_type_name) || (photoRequired && fieldShown('photo') && !photo) || industryRequiredMissing) ? 0.5 : 1
            }}
          >
            Continue
          </button>
        </div>
      )}

      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {fieldShown('host') && (
          <div>
            <label style={labelStyle}>{terms.visiting}</label>

            {/* Searchable Host Dropdown */}
            <div ref={hostDropdownRef} style={{ position: 'relative' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '14px 16px', borderRadius: 14,
                border: '2px solid rgba(255,255,255,0.2)',
                background: 'rgba(255,255,255,0.1)',
                cursor: 'pointer'
              }}>
                <Search size={20} color="rgba(255,255,255,0.6)" />
                <input
                  type="text"
                  value={hostSearch}
                  onChange={(e) => {
                    setHostSearch(e.target.value);
                    setShowHostDropdown(true);
                    if (selectedHost) {
                      setSelectedHost(null);
                      setFormData({ ...formData, host_id: '' });
                    }
                  }}
                  onFocus={() => setShowHostDropdown(true)}
                  placeholder={`Search ${terms.hostsLower}...`}
                  style={{
                    flex: 1, background: 'transparent', border: 'none',
                    color: '#fff', fontSize: 18, outline: 'none'
                  }}
                />
                {selectedHost && (
                  <button onClick={clearHost} style={{
                    background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)',
                    cursor: 'pointer', padding: 4
                  }}>
                    <X size={18} />
                  </button>
                )}
                <ChevronDown size={20} color="rgba(255,255,255,0.6)" />
              </div>

              {/* Dropdown */}
              {showHostDropdown && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0,
                  marginTop: 8, maxHeight: 320, overflowY: 'auto',
                  background: 'rgba(15, 23, 42, 0.95)', borderRadius: 14,
                  border: '1px solid rgba(255,255,255,0.2)',
                  backdropFilter: 'blur(20px)', zIndex: 100,
                  boxShadow: '0 20px 60px rgba(0,0,0,0.4)'
                }}>
                  {filteredHosts.length === 0 ? (
                    <div style={{ padding: 20, color: 'rgba(255,255,255,0.5)', textAlign: 'center' }}>
                      No {terms.hostsLower} found
                    </div>
                  ) : (
                    filteredHosts.map(host => (
                      <button
                        key={host.id}
                        onClick={() => selectHost(host)}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', gap: 14,
                          padding: '14px 16px', border: 'none',
                          background: formData.host_id === host.id ? 'rgba(13, 115, 119, 0.3)' : 'transparent',
                          color: '#fff', cursor: 'pointer', textAlign: 'left',
                          borderBottom: '1px solid rgba(255,255,255,0.05)'
                        }}
                      >
                        <div style={{
                          width: 40, height: 40, borderRadius: '50%',
                          background: 'linear-gradient(135deg, #0D7377, #14FFEC)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 700, fontSize: 14, color: '#fff', flexShrink: 0
                        }}>
                          {host.first_name[0]}{host.last_name[0]}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 15 }}>{host.first_name} {host.last_name}</div>
                          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
                            {host.department} {host.job_title && `• ${host.job_title}`}
                          </div>
                        </div>
                        {formData.host_id === host.id && (
                          <div style={{
                            width: 20, height: 20, borderRadius: '50%',
                            background: '#14FFEC', display: 'flex',
                            alignItems: 'center', justifyContent: 'center'
                          }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0F172A" strokeWidth="4">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </div>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
          )}

          {fieldShown('purpose') && (
            <div>
              <label style={labelStyle}><FileText size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Purpose of Visit</label>
              <textarea
                value={formData.purpose}
                onChange={(e) => updateField('purpose', e.target.value)}
                style={{ ...inputStyle, minHeight: 100, resize: 'none', ...errBorder('purpose') }}
                placeholder="Meeting, interview, delivery, etc."
              />
              {errText('purpose')}
            </div>
          )}

          {/* Org-defined custom registration fields */}
          {customFields.map((f) => (
            <div key={f.label}>
              {f.type === 'checkbox' ? (
                <label style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#fff', fontSize: 16, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={!!customData[f.label]}
                    onChange={(e) => setCustomData({ ...customData, [f.label]: e.target.checked })}
                    style={{ width: 24, height: 24 }}
                  />
                  {f.label}{f.required ? ' *' : ''}
                </label>
              ) : (
                <>
                  <label style={labelStyle}>{f.label}{f.required ? ' *' : ''}</label>
                  {f.type === 'dropdown' ? (
                    <select
                      value={customData[f.label] || ''}
                      onChange={(e) => setCustomData({ ...customData, [f.label]: e.target.value })}
                      style={{ ...inputStyle, background: 'rgba(255,255,255,0.1)' }}
                    >
                      <option value="" style={{ color: '#000' }}>Select…</option>
                      {(f.options || []).map(o => <option key={o} value={o} style={{ color: '#000' }}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      type="text" value={customData[f.label] || ''}
                      onChange={(e) => setCustomData({ ...customData, [f.label]: e.target.value })}
                      style={inputStyle} placeholder={f.label}
                    />
                  )}
                </>
              )}
            </div>
          ))}

          {fieldShown('vehicle_plate') && (
            <div>
              <label style={labelStyle}><Car size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Vehicle Plate (optional)</label>
              <input
                type="text" value={formData.vehicle_plate}
                onChange={(e) => updateField('vehicle_plate', e.target.value)}
                style={{ ...inputStyle, ...errBorder('vehicle_plate') }} placeholder="ABC-1234"
              />
              {errText('vehicle_plate')}
            </div>
          )}

          {errorMsg && (
            <div style={{
              padding: '14px 18px', borderRadius: 12,
              background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.5)',
              color: '#FCA5A5', fontSize: 15, fontWeight: 500, textAlign: 'center'
            }} onClick={() => setErrorMsg('')}>
              {errorMsg}
            </div>
          )}

          <button
            onClick={ndaRequired ? goToNdaStep : handleSubmit}
            disabled={loading || (fieldShown('host') && !formData.host_id) || customRequiredMissing}
            style={{
              marginTop: 20, padding: '20px', borderRadius: 16,
              background: (loading || (fieldShown('host') && !formData.host_id) || customRequiredMissing) ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, #FF6B35, #FF8C5A)',
              border: 'none', color: '#fff', fontSize: 20, fontWeight: 700,
              cursor: (loading || (fieldShown('host') && !formData.host_id) || customRequiredMissing) ? 'not-allowed' : 'pointer',
              opacity: (loading || (fieldShown('host') && !formData.host_id) || customRequiredMissing) ? 0.5 : 1
            }}
          >
            {loading ? 'Processing...' : ndaRequired ? 'Continue to NDA' : 'Complete Sign In'}
          </button>
        </div>
      )}

      {step === 3 && ndaRequired && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <label style={labelStyle}>
              <PenLine size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Please read and sign to enter
            </label>
            <div style={{
              background: 'rgba(255,255,255,0.95)', borderRadius: 14,
              padding: '20px 22px', maxHeight: 220, overflowY: 'auto',
              color: '#1E293B', fontSize: 14, lineHeight: 1.6,
              whiteSpace: 'pre-wrap', border: '2px solid rgba(255,255,255,0.3)'
            }}>
              {ndaText || DEFAULT_NDA_TEXT}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Your signature</label>
            <SignaturePad onChange={setNdaSig} height={170} />
          </div>

          <div>
            <label style={labelStyle}>Type your full legal name</label>
            <input
              type="text" value={ndaName}
              onChange={(e) => setNdaName(e.target.value)}
              style={inputStyle} placeholder="Full name"
            />
          </div>

          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', textAlign: 'center' }}>
            By signing, you agree to the document above. A copy is stored with your visit record.
          </div>

          {errorMsg && (
            <div style={{
              padding: '14px 18px', borderRadius: 12,
              background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.5)',
              color: '#FCA5A5', fontSize: 15, fontWeight: 500, textAlign: 'center'
            }} onClick={() => setErrorMsg('')}>
              {errorMsg}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading || !ndaSig || !ndaName.trim()}
            style={{
              marginTop: 4, padding: '20px', borderRadius: 16,
              background: (loading || !ndaSig || !ndaName.trim()) ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, #FF6B35, #FF8C5A)',
              border: 'none', color: '#fff', fontSize: 20, fontWeight: 700,
              cursor: (loading || !ndaSig || !ndaName.trim()) ? 'not-allowed' : 'pointer',
              opacity: (loading || !ndaSig || !ndaName.trim()) ? 0.5 : 1
            }}
          >
            {loading ? 'Processing...' : 'Sign & Complete Sign In'}
          </button>
        </div>
      )}
    </div>
  );
}
