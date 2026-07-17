import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { Plus, Calendar, Mail, QrCode, Copy, Check, AlertCircle } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import api from '../utils/api';

export default function PreRegistered() {
  const [showModal, setShowModal] = useState(false);
  const [showQR, setShowQR] = useState(null);
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', phone: '', company: '',
    host_id: '', visitor_type_id: '', purpose: '', expected_date: '',
    expected_time_start: '', expected_time_end: ''
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const { data: preRegs, refetch } = useQuery('pre-registered', () =>
    api.get('/pre-registered').then(r => r.data)
  );

  const { data: hosts } = useQuery('hosts-list', () =>
    api.get('/hosts').then(r => r.data)
  );

  const { data: visitorTypes } = useQuery('visitor-types-list', () =>
    api.get('/visitor-types').then(r => r.data)
  );

  const validateForm = () => {
    const newErrors = {};

    if (!form.first_name?.trim()) newErrors.first_name = 'First name is required';
    if (!form.last_name?.trim()) newErrors.last_name = 'Last name is required';
    if (!form.email?.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      newErrors.email = 'Please enter a valid email';
    }
    if (!form.host_id) newErrors.host_id = 'Please select a host';
    if (!form.visitor_type_id) newErrors.visitor_type_id = 'Please select a visitor type';
    if (!form.expected_date) newErrors.expected_date = 'Expected date is required';
    if (!form.expected_time_start) newErrors.expected_time_start = 'Start time is required';
    if (!form.expected_time_end) newErrors.expected_time_end = 'End time is required';

    // Check if end time is after start time
    if (form.expected_time_start && form.expected_time_end) {
      if (form.expected_time_end <= form.expected_time_start) {
        newErrors.expected_time_end = 'End time must be after start time';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return; // Stop if validation fails
    }

    setSubmitting(true);
    try {
      await api.post('/pre-registered', form);
      setShowModal(false);
      setForm({ first_name: '', last_name: '', email: '', phone: '', company: '', host_id: '', visitor_type_id: '', purpose: '', expected_date: '', expected_time_start: '', expected_time_end: '' });
      setErrors({});
      refetch();
    } catch (err) {
      const serverError = err.response?.data?.error || err.response?.data?.details || 'Failed to create pre-registration';
      alert(serverError);
    } finally {
      setSubmitting(false);
    }
  };

  const handleChange = (field, value) => {
    setForm({ ...form, [field]: value });
    // Clear error when user types
    if (errors[field]) {
      setErrors({ ...errors, [field]: null });
    }
  };

  const inputStyle = (field) => ({
    width: '100%', padding: '12px 16px', borderRadius: 10,
    border: `2px solid ${errors[field] ? '#EF4444' : '#E2E8F0'}`,
    fontSize: 14, outline: 'none', background: '#fff'
  });

  const errorStyle = {
    color: '#EF4444', fontSize: 12, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0F172A' }}>Pre-Registered Visitors</h1>
          <p style={{ color: '#64748B', marginTop: 4 }}>Invite visitors ahead of time with QR codes</p>
        </div>
        <button
          onClick={() => { setShowModal(true); setErrors({}); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 24px', borderRadius: 12,
            background: '#0D7377', border: 'none', color: '#fff',
            fontWeight: 600, cursor: 'pointer', fontSize: 14
          }}
        >
          <Plus size={18} /> Pre-Register Visitor
        </button>
      </div>

      <div style={{
        background: '#fff', borderRadius: 20, overflow: 'hidden',
        boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#F8FAFC' }}>
              {['Visitor', 'Host', 'Date', 'Status', 'Actions'].map(h => (
                <th key={h} style={{ padding: '16px 20px', textAlign: 'left', fontSize: 13, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preRegs?.map(pr => (
              <tr key={pr.id} style={{ borderTop: '1px solid #E2E8F0' }}>
                <td style={{ padding: '16px 20px' }}>
                  <div style={{ fontWeight: 600, color: '#0F172A', fontSize: 14 }}>
                    {pr.first_name} {pr.last_name}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748B' }}>{pr.email}</div>
                </td>
                <td style={{ padding: '16px 20px', fontSize: 14, color: '#334155' }}>
                  {pr.host_first_name} {pr.host_last_name}
                </td>
                <td style={{ padding: '16px 20px', fontSize: 13, color: '#64748B' }}>
                  {pr.expected_date ? new Date(pr.expected_date).toLocaleDateString() : '-'} {pr.expected_time_start || ''}
                </td>
                <td style={{ padding: '16px 20px' }}>
                  <span style={{
                    fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 20,
                    background: pr.invitation_status === 'used' ? '#DCFCE7' : pr.invitation_status === 'sent' ? '#DBEAFE' : '#F1F5F9',
                    color: pr.invitation_status === 'used' ? '#166534' : pr.invitation_status === 'sent' ? '#1E40AF' : '#64748B'
                  }}>
                    {pr.invitation_status}
                  </span>
                </td>
                <td style={{ padding: '16px 20px' }}>
                  <button
                    onClick={() => setShowQR(pr)}
                    style={{
                      padding: '8px 16px', borderRadius: 8,
                      background: '#0D7377', border: 'none', color: '#fff',
                      fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 6
                    }}
                  >
                    <QrCode size={14} /> View QR
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Modal */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }}>
          <div style={{
            background: '#fff', borderRadius: 20, padding: 32, width: '100%', maxWidth: 500,
            maxHeight: '90vh', overflow: 'auto', boxShadow: '0 25px 80px rgba(0,0,0,0.3)'
          }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Pre-Register Visitor</h2>
            <p style={{ color: '#64748B', fontSize: 14, marginBottom: 24 }}>
              Fields marked with <span style={{ color: '#EF4444' }}>*</span> are required
            </p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Name Row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 6, display: 'block' }}>
                    First Name <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input type="text" placeholder="First Name" 
                    value={form.first_name} onChange={(e) => handleChange('first_name', e.target.value)}
                    style={inputStyle('first_name')} />
                  {errors.first_name && <span style={errorStyle}><AlertCircle size={12} /> {errors.first_name}</span>}
                </div>
                <div>
                  <label style={{ fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 6, display: 'block' }}>
                    Last Name <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input type="text" placeholder="Last Name"
                    value={form.last_name} onChange={(e) => handleChange('last_name', e.target.value)}
                    style={inputStyle('last_name')} />
                  {errors.last_name && <span style={errorStyle}><AlertCircle size={12} /> {errors.last_name}</span>}
                </div>
              </div>

              {/* Email */}
              <div>
                <label style={{ fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 6, display: 'block' }}>
                  Email <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <input type="email" placeholder="Email"
                  value={form.email} onChange={(e) => handleChange('email', e.target.value)}
                  style={inputStyle('email')} />
                {errors.email && <span style={errorStyle}><AlertCircle size={12} /> {errors.email}</span>}
              </div>

              {/* Phone */}
              <div>
                <label style={{ fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 6, display: 'block' }}>
                  Phone
                </label>
                <input type="tel" placeholder="Phone"
                  value={form.phone} onChange={(e) => handleChange('phone', e.target.value)}
                  style={inputStyle('phone')} />
              </div>

              {/* Company */}
              <div>
                <label style={{ fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 6, display: 'block' }}>
                  Company
                </label>
                <input type="text" placeholder="Company"
                  value={form.company} onChange={(e) => handleChange('company', e.target.value)}
                  style={inputStyle('company')} />
              </div>

              {/* Host */}
              <div>
                <label style={{ fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 6, display: 'block' }}>
                  Host <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <select
                  value={form.host_id} onChange={(e) => handleChange('host_id', e.target.value)}
                  style={inputStyle('host_id')}
                >
                  <option value="">Select a host</option>
                  {hosts?.map(h => <option key={h.id} value={h.id}>{h.first_name} {h.last_name}</option>)}
                </select>
                {errors.host_id && <span style={errorStyle}><AlertCircle size={12} /> {errors.host_id}</span>}
              </div>

              {/* Visitor Type */}
              <div>
                <label style={{ fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 6, display: 'block' }}>
                  Visitor Type <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <select
                  value={form.visitor_type_id} onChange={(e) => handleChange('visitor_type_id', e.target.value)}
                  style={inputStyle('visitor_type_id')}
                >
                  <option value="">Select visitor type</option>
                  {visitorTypes?.map(vt => <option key={vt.id} value={vt.id}>{vt.name}</option>)}
                </select>
                {errors.visitor_type_id && <span style={errorStyle}><AlertCircle size={12} /> {errors.visitor_type_id}</span>}
              </div>

              {/* Purpose */}
              <div>
                <label style={{ fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 6, display: 'block' }}>
                  Purpose
                </label>
                <input type="text" placeholder="Purpose of visit"
                  value={form.purpose} onChange={(e) => handleChange('purpose', e.target.value)}
                  style={inputStyle('purpose')} />
              </div>

              {/* Date */}
              <div>
                <label style={{ fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 6, display: 'block' }}>
                  Expected Date <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <input type="date"
                  value={form.expected_date} onChange={(e) => handleChange('expected_date', e.target.value)}
                  style={inputStyle('expected_date')} />
                {errors.expected_date && <span style={errorStyle}><AlertCircle size={12} /> {errors.expected_date}</span>}
              </div>

              {/* Time Row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 6, display: 'block' }}>
                    Start Time <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input type="time"
                    value={form.expected_time_start} onChange={(e) => handleChange('expected_time_start', e.target.value)}
                    style={inputStyle('expected_time_start')} />
                  {errors.expected_time_start && <span style={errorStyle}><AlertCircle size={12} /> {errors.expected_time_start}</span>}
                </div>
                <div>
                  <label style={{ fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 6, display: 'block' }}>
                    End Time <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input type="time"
                    value={form.expected_time_end} onChange={(e) => handleChange('expected_time_end', e.target.value)}
                    style={inputStyle('expected_time_end')} />
                  {errors.expected_time_end && <span style={errorStyle}><AlertCircle size={12} /> {errors.expected_time_end}</span>}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <button type="button" onClick={() => { setShowModal(false); setErrors({}); }}
                  style={{ flex: 1, padding: '14px', borderRadius: 10, background: '#F1F5F9', border: 'none', fontWeight: 600, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button type="submit" disabled={submitting}
                  style={{ flex: 1, padding: '14px', borderRadius: 10, background: submitting ? '#94A3B8' : '#0D7377', border: 'none', color: '#fff', fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer' }}>
                  {submitting ? 'Sending...' : 'Send Invitation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QR Modal */}
      {showQR && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }}>
          <div style={{
            background: '#fff', borderRadius: 20, padding: 32, textAlign: 'center',
            boxShadow: '0 25px 80px rgba(0,0,0,0.3)'
          }}>
            <h3 style={{ marginBottom: 16 }}>QR Code for {showQR.first_name} {showQR.last_name}</h3>
            <div style={{ padding: 20, background: '#F8FAFC', borderRadius: 16, marginBottom: 16 }}>
              <QRCodeSVG
                value={`${window.location.origin}/check-in/${showQR.qr_code}`}
                size={200}
                level="H"
                includeMargin={true}
              />
            </div>
            <p style={{ fontSize: 13, color: '#64748B', marginBottom: 16 }}>
              Scan this QR code or share the link below
            </p>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#F1F5F9', padding: '12px 16px', borderRadius: 10, marginBottom: 16
            }}>
              <input
                type="text" readOnly
                value={`${window.location.origin}/check-in/${showQR.qr_code}`}
                style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 13, outline: 'none' }}
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/check-in/${showQR.qr_code}`);
                  alert('Copied!');
                }}
                style={{ padding: '6px 12px', borderRadius: 6, background: '#0D7377', border: 'none', color: '#fff', fontSize: 12, cursor: 'pointer' }}
              >
                <Copy size={14} /> Copy
              </button>
            </div>
            <button onClick={() => setShowQR(null)}
              style={{ padding: '12px 32px', borderRadius: 10, background: '#F1F5F9', border: 'none', fontWeight: 600, cursor: 'pointer' }}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
