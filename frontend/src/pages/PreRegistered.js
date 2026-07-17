import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { Plus, Calendar, Mail, QrCode, Copy, Check } from 'lucide-react';
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

  const { data: preRegs, refetch } = useQuery('pre-registered', () =>
    api.get('/pre-registered').then(r => r.data)
  );

  const { data: hosts } = useQuery('hosts-list', () =>
    api.get('/hosts').then(r => r.data)
  );

  const { data: visitorTypes } = useQuery('visitor-types-list', () =>
    api.get('/visitor-types').then(r => r.data)
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/pre-registered', form);
      setShowModal(false);
      setForm({ first_name: '', last_name: '', email: '', phone: '', company: '', host_id: '', visitor_type_id: '', purpose: '', expected_date: '', expected_time_start: '', expected_time_end: '' });
      refetch();
    } catch (err) {
      alert('Failed to create pre-registration');
    }
  };

  const inputStyle = {
    width: '100%', padding: '12px 16px', borderRadius: 10,
    border: '2px solid #E2E8F0', fontSize: 14, outline: 'none'
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0F172A' }}>Pre-Registered Visitors</h1>
          <p style={{ color: '#64748B', marginTop: 4 }}>Invite visitors ahead of time with QR codes</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
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
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Pre-Register Visitor</h2>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <input type="text" placeholder="First Name" required value={form.first_name}
                  onChange={(e) => setForm({...form, first_name: e.target.value})} style={inputStyle} />
                <input type="text" placeholder="Last Name" required value={form.last_name}
                  onChange={(e) => setForm({...form, last_name: e.target.value})} style={inputStyle} />
              </div>
              <input type="email" placeholder="Email" required value={form.email}
                onChange={(e) => setForm({...form, email: e.target.value})} style={inputStyle} />
              <input type="tel" placeholder="Phone" value={form.phone}
                onChange={(e) => setForm({...form, phone: e.target.value})} style={inputStyle} />
              <input type="text" placeholder="Company" value={form.company}
                onChange={(e) => setForm({...form, company: e.target.value})} style={inputStyle} />
              <select value={form.host_id} onChange={(e) => setForm({...form, host_id: e.target.value})} style={inputStyle}>
                <option value="">Select Host</option>
                {hosts?.map(h => <option key={h.id} value={h.id}>{h.first_name} {h.last_name}</option>)}
              </select>
              <select value={form.visitor_type_id} onChange={(e) => setForm({...form, visitor_type_id: e.target.value})} style={inputStyle}>
                <option value="">Select Visitor Type</option>
                {visitorTypes?.map(vt => <option key={vt.id} value={vt.id}>{vt.name}</option>)}
              </select>
              <input type="text" placeholder="Purpose" value={form.purpose}
                onChange={(e) => setForm({...form, purpose: e.target.value})} style={inputStyle} />
              <input type="date" value={form.expected_date}
                onChange={(e) => setForm({...form, expected_date: e.target.value})} style={inputStyle} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <input type="time" value={form.expected_time_start}
                  onChange={(e) => setForm({...form, expected_time_start: e.target.value})} style={inputStyle} />
                <input type="time" value={form.expected_time_end}
                  onChange={(e) => setForm({...form, expected_time_end: e.target.value})} style={inputStyle} />
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <button type="button" onClick={() => setShowModal(false)}
                  style={{ flex: 1, padding: '14px', borderRadius: 10, background: '#F1F5F9', border: 'none', fontWeight: 600, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button type="submit"
                  style={{ flex: 1, padding: '14px', borderRadius: 10, background: '#0D7377', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                  Send Invitation
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
