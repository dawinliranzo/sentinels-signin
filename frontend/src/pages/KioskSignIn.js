import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Building, User, Mail, Phone, Car, FileText, Search, ChevronDown, X } from 'lucide-react';
import api from '../utils/api';

export default function KioskSignIn() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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

  // Host dropdown state
  const [hostSearch, setHostSearch] = useState('');
  const [showHostDropdown, setShowHostDropdown] = useState(false);
  const [selectedHost, setSelectedHost] = useState(null);
  const hostDropdownRef = useRef(null);

  const orgId = searchParams.get('org') || localStorage.getItem('kiosk_org_id') || '00000000-0000-0000-0000-000000000001';

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

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const res = await api.post('/visits/check-in', {
        org_id: orgId,
        ...formData,
        sign_in_method: 'kiosk'
      });
      setVisitResult(res.data);
      setStep(3);
    } catch (err) {
      alert('Sign-in failed: ' + (err.response?.data?.error || 'Unknown error'));
    } finally {
      setLoading(false);
    }
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

  if (step === 3 && visitResult) {
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
          onClick={() => navigate('/kiosk')}
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
          onClick={() => step > 1 ? setStep(step - 1) : navigate('/kiosk')}
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
          <h2 style={{ fontSize: 28, fontWeight: 700, color: '#fff' }}>Sign In</h2>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>Step {step} of 2</p>
        </div>
      </div>

      {/* Progress Bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 32 }}>
        {[1, 2].map(s => (
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
                onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                style={inputStyle} placeholder="John"
              />
            </div>
            <div>
              <label style={labelStyle}>Last Name</label>
              <input
                type="text" value={formData.last_name}
                onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                style={inputStyle} placeholder="Doe"
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}><Mail size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Email</label>
            <input
              type="email" value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              style={inputStyle} placeholder="john@company.com"
            />
          </div>

          <div>
            <label style={labelStyle}><Phone size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Phone</label>
            <input
              type="tel" value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              style={inputStyle} placeholder="(555) 123-4567"
            />
          </div>

          <div>
            <label style={labelStyle}><Building size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Company</label>
            <input
              type="text" value={formData.company}
              onChange={(e) => setFormData({ ...formData, company: e.target.value })}
              style={inputStyle} placeholder="Acme Inc."
            />
          </div>

          <button
            onClick={() => setStep(2)}
            disabled={!formData.first_name || !formData.last_name || !formData.visitor_type_id}
            style={{
              marginTop: 20, padding: '20px', borderRadius: 16,
              background: (!formData.first_name || !formData.last_name || !formData.visitor_type_id) ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, #FF6B35, #FF8C5A)',
              border: 'none', color: '#fff', fontSize: 20, fontWeight: 700,
              cursor: (!formData.first_name || !formData.last_name || !formData.visitor_type_id) ? 'not-allowed' : 'pointer',
              opacity: (!formData.first_name || !formData.last_name || !formData.visitor_type_id) ? 0.5 : 1
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
              onChange={(e) => setFormData({ ...formData, purpose: e.target.value })}
              style={{ ...inputStyle, minHeight: 100, resize: 'none' }}
              placeholder="Meeting, interview, delivery, etc."
            />
          </div>

          <div>
            <label style={labelStyle}><Car size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Vehicle Plate (optional)</label>
            <input
              type="text" value={formData.vehicle_plate}
              onChange={(e) => setFormData({ ...formData, vehicle_plate: e.target.value })}
              style={inputStyle} placeholder="ABC-1234"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={loading || !formData.host_id}
            style={{
              marginTop: 20, padding: '20px', borderRadius: 16,
              background: (!formData.host_id || loading) ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, #FF6B35, #FF8C5A)',
              border: 'none', color: '#fff', fontSize: 20, fontWeight: 700,
              cursor: (!formData.host_id || loading) ? 'not-allowed' : 'pointer',
              opacity: (!formData.host_id || loading) ? 0.5 : 1
            }}
          >
            {loading ? 'Processing...' : 'Complete Sign In'}
          </button>
        </div>
      )}
    </div>
  );
}
