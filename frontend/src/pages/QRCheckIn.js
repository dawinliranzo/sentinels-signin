import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../utils/api';

export default function QRCheckIn() {
  const { token } = useParams();
  const [visitor, setVisitor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checkedIn, setCheckedIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [already, setAlready] = useState(false);
  const [error, setError] = useState(null);

  const usedKey = `qr_used_${token}`;

  useEffect(() => {
    // This device already used this link — don't offer the form again
    if (localStorage.getItem(usedKey) === '1') {
      setAlready(true);
      setLoading(false);
      return;
    }
    api.get(`/pre-registered/validate-qr/${token}`)
      .then(r => { setVisitor(r.data.visitor); setLoading(false); })
      .catch(() => setLoading(false));
  }, [token]);

  const handleCheckIn = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
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
        sign_in_method: 'qr_code'
      });
      // Backend returns already_checked_in when an active visit exists
      if (r.data?.already_checked_in) setAlready(true);
      localStorage.setItem(usedKey, '1');
      setCheckedIn(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Check-in failed — please try again');
      setSubmitting(false);
    }
  };

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Loading...</div>;
  if (!visitor && !already) return <div style={{ textAlign: 'center', padding: 40 }}><h2>Invalid or expired QR code</h2></div>;
  if (checkedIn || already) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0D7377', padding: 24, textAlign: 'center' }}>
      <h1 style={{ color: '#fff', fontSize: 48 }}>✓ Checked In!</h1>
      <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 20 }}>
        {already && !checkedIn ? 'This link was already used to check in.' : `Welcome${visitor ? `, ${visitor.first_name}` : ''}`}
      </p>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 24, background: '#F1F5F9' }}>
      <div style={{ maxWidth: 500, width: '100%', background: '#fff', borderRadius: 24, padding: 40, boxShadow: '0 20px 60px rgba(0,0,0,0.1)' }}>
        <h2 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Confirm Your Visit</h2>
        <p style={{ color: '#64748B', marginBottom: 32 }}>Please review your details and confirm check-in</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #E2E8F0' }}>
            <span style={{ color: '#64748B' }}>Name</span>
            <span style={{ fontWeight: 600 }}>{visitor.first_name} {visitor.last_name}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #E2E8F0' }}>
            <span style={{ color: '#64748B' }}>Company</span>
            <span style={{ fontWeight: 600 }}>{visitor.company || 'N/A'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #E2E8F0' }}>
            <span style={{ color: '#64748B' }}>Host</span>
            <span style={{ fontWeight: 600 }}>{visitor.host_first_name} {visitor.host_last_name}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0' }}>
            <span style={{ color: '#64748B' }}>Purpose</span>
            <span style={{ fontWeight: 600 }}>{visitor.purpose || 'N/A'}</span>
          </div>
        </div>

        {error && <p style={{ color: '#EF4444', fontSize: 14, marginBottom: 16, textAlign: 'center' }}>{error}</p>}

        <button
          onClick={handleCheckIn}
          disabled={submitting}
          style={{
            width: '100%', padding: '18px', borderRadius: 14,
            background: submitting ? '#94A3B8' : '#0D7377', border: 'none', color: '#fff',
            fontSize: 18, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer'
          }}
        >
          {submitting ? 'Checking in...' : 'Confirm Check-In'}
        </button>
      </div>
    </div>
  );
}
