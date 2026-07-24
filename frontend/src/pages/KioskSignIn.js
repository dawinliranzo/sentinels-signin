import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Building, User, Mail, Phone, Car, FileText, Search, ChevronDown, X, Camera, PenLine } from 'lucide-react';
import api from '../utils/api';
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
    company: '', host_id: '', visitor_type_id: '',
    purpose: '', vehicle_plate: '',
  });
  const [visitResult, setVisitResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

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

  // Custom registration fields (org-configurable, Settings → Registration Form)
  const [customFields, setCustomFields] = useState([]);
  const [customData, setCustomData] = useState({});

  // Photo capture (org-configurable)
  const [photoRequired, setPhotoRequired] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [cameraOn, setCameraOn] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    if (!orgId) return;
    api.get(`/kiosk/config/${orgId}`).then(r => {
      setPhotoRequired(!!r.data.photo_required);
      setNdaRequired(!!r.data.nda_required);
      setNdaText(r.data.nda_text || '');
      const cf = Array.isArray(r.data.custom_fields) ? r.data.custom_fields : [];
      setCustomFields(cf);
      // pre-fill checkbox defaults
      const init = {};
      cf.forEach(f => { if (f.type === 'checkbox') init[f.label] = false; });
      setCustomData(init);
    }).catch(() => {});
  }, [orgId]);

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
    setVisitorTypes([
      { id: '10000000-0000-0000-0000-000000000001', name: 'Guest', badge_color: '#0D7377' },
      { id: '10000000-0000-0000-0000-000000000002', name: 'Contractor', badge_color: '#FF6B35' },
      { id: '10000000-0000-0000-0000-000000000003', name: 'Delivery', badge_color: '#2ECC71' },
      { id: '10000000-0000-0000-0000-000000000004', name: 'Interview', badge_color: '#9B59B6' },
    ]);

    if (!orgId) return;

    api.get(`/hosts/public/${orgId}`).then(r => {
      if (r.data && r.data.length > 0) setHosts(r.data);
    }).catch(() => {});

    api.get(`/visitor-types/public/${orgId}`).then(r => {
      if (r.data && r.data.length > 0) setVisitorTypes(r.data);
    }).catch(() => {});
  }, [orgId]);

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

  // Required custom fields gate step 1's Continue button
  const customRequiredMissing = customFields.some(f => {
    if (!f.required) return false;
    const v = customData[f.label];
    return f.type === 'checkbox' ? !v : !v || !String(v).trim();
  });

  const handleSubmit = async () => {
    if (!validateStep2()) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await api.post('/visits/check-in', {
        org_id: orgId,
        ...formData,
        sign_in_method: 'kiosk',
        photo_data: photo,
        custom_data: Object.keys(customData).length > 0 ? customData : undefined,
        nda_signature: ndaRequired ? ndaSig : undefined,
        nda_signed_name: ndaRequired ? ndaName : undefined
      });
      setVisitResult(res.data);
      setDone(true);
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
          <div>
            <label style={labelStyle}>I am a...</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {visitorTypes.map(vt => (
                <button
                  key={vt.id}
                  onClick={() => setFormData({ ...formData, visitor_type_id: vt.id })}
                  style={{
                    padding: '20px 16px', borderRadius: 14,
                    background: formData.visitor_type_id === vt.id ? vt.badge_color : 'rgba(255,255,255,0.1)',
                    border: `2px solid ${formData.visitor_type_id === vt.id ? vt.badge_color : 'rgba(255,255,255,0.2)'}`,
                    color: '#fff', fontSize: 16, fontWeight: 600, cursor: 'pointer',
                    textAlign: 'center'
                  }}
                >
                  {vt.name}
                </button>
              ))}
            </div>
          </div>

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

          <div>
            <label style={labelStyle}><Mail size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Email</label>
            <input
              type="email" value={formData.email}
              onChange={(e) => updateField('email', e.target.value)}
              style={{ ...inputStyle, ...errBorder('email') }} placeholder="john@company.com"
            />
            {errText('email')}
          </div>

          <div>
            <label style={labelStyle}><Phone size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Phone</label>
            <input
              type="tel" value={formData.phone}
              onChange={(e) => updateField('phone', e.target.value)}
              style={{ ...inputStyle, ...errBorder('phone') }} placeholder="(555) 123-4567"
            />
            {errText('phone')}
          </div>

          <div>
            <label style={labelStyle}><Building size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Company</label>
            <input
              type="text" value={formData.company}
              onChange={(e) => setFormData({ ...formData, company: e.target.value })}
              style={inputStyle} placeholder="Acme Inc."
            />
          </div>

          {photoRequired && (
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
            disabled={!formData.first_name || !formData.last_name || !formData.visitor_type_id || (photoRequired && !photo) || customRequiredMissing}
            style={{
              marginTop: 20, padding: '20px', borderRadius: 16,
              background: (!formData.first_name || !formData.last_name || !formData.visitor_type_id || (photoRequired && !photo) || customRequiredMissing) ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, #FF6B35, #FF8C5A)',
              border: 'none', color: '#fff', fontSize: 20, fontWeight: 700,
              cursor: (!formData.first_name || !formData.last_name || !formData.visitor_type_id || (photoRequired && !photo) || customRequiredMissing) ? 'not-allowed' : 'pointer',
              opacity: (!formData.first_name || !formData.last_name || !formData.visitor_type_id || (photoRequired && !photo) || customRequiredMissing) ? 0.5 : 1
            }}
          >
            Continue
          </button>
        </div>
      )}

      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <label style={labelStyle}>I'm here to see...</label>

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
                  placeholder="Search for a host..."
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
                      No hosts found
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

          <div>
            <label style={labelStyle}><Car size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Vehicle Plate (optional)</label>
            <input
              type="text" value={formData.vehicle_plate}
              onChange={(e) => updateField('vehicle_plate', e.target.value)}
              style={{ ...inputStyle, ...errBorder('vehicle_plate') }} placeholder="ABC-1234"
            />
            {errText('vehicle_plate')}
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
            onClick={ndaRequired ? goToNdaStep : handleSubmit}
            disabled={loading || !formData.host_id}
            style={{
              marginTop: 20, padding: '20px', borderRadius: 16,
              background: (!formData.host_id || loading) ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, #FF6B35, #FF8C5A)',
              border: 'none', color: '#fff', fontSize: 20, fontWeight: 700,
              cursor: (!formData.host_id || loading) ? 'not-allowed' : 'pointer',
              opacity: (!formData.host_id || loading) ? 0.5 : 1
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
