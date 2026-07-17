import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, Building, User, Mail, Phone, Car, FileText } from 'lucide-react';
import api from '../utils/api';

export default function KioskSignIn() {
  const navigate = useNavigate();
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

  React.useEffect(() => {
    // Fetch hosts and visitor types for dropdowns
    // In production, this would use the org_id from the kiosk config
    const orgId = localStorage.getItem('kiosk_org_id') || '00000000-0000-0000-0000-000000000001';

    // Always set default visitor types immediately so UI never shows empty
    setVisitorTypes([
      { id: '10000000-0000-0000-0000-000000000001', name: 'Guest', badge_color: '#0D7377' },
      { id: '10000000-0000-0000-0000-000000000002', name: 'Contractor', badge_color: '#FF6B35' },
      { id: '10000000-0000-0000-0000-000000000003', name: 'Delivery', badge_color: '#2ECC71' },
      { id: '10000000-0000-0000-0000-000000000004', name: 'Interview', badge_color: '#9B59B6' },
    ]);

    // Try to load from API, but fallback to defaults on error
    api.get(`/hosts?org_id=${orgId}`).then(r => {
      if (r.data && r.data.length > 0) setHosts(r.data);
    }).catch(() => {
      // Keep defaults
    });

    api.get(`/visitor-types?org_id=${orgId}`).then(r => {
      if (r.data && r.data.length > 0) setVisitorTypes(r.data);
    }).catch(() => {
      // Keep defaults already set above
    });
  }, []);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const orgId = localStorage.getItem('kiosk_org_id') || '00000000-0000-0000-0000-000000000001';
      const res = await api.post('/visits/check-in', {
        org_id: orgId,
        ...formData,
        sign_in_method: 'kiosk'
      });
      setVisitResult(res.data);
      setStep(3);
    } catch (err) {
      alert('Sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {hosts.map(host => (
                <button
                  key={host.id}
                  onClick={() => setFormData({ ...formData, host_id: host.id })}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 16,
                    padding: '18px 20px', borderRadius: 14,
                    background: formData.host_id === host.id ? 'rgba(13, 115, 119, 0.4)' : 'rgba(255,255,255,0.1)',
                    border: `2px solid ${formData.host_id === host.id ? '#14FFEC' : 'rgba(255,255,255,0.2)'}`,
                    color: '#fff', fontSize: 16, cursor: 'pointer', textAlign: 'left'
                  }}
                >
                  <div style={{
                    width: 44, height: 44, borderRadius: '50%',
                    background: 'linear-gradient(135deg, #0D7377, #14FFEC)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: 16
                  }}>
                    {host.first_name[0]}{host.last_name[0]}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>{host.first_name} {host.last_name}</div>
                    <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>{host.department}</div>
                  </div>
                </button>
              ))}
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
