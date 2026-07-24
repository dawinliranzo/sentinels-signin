import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { Plus, QrCode, Copy, AlertCircle, Pencil, Trash2, RefreshCw, Printer, Star } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import api from '../utils/api';
import { toast } from '../utils/toast';

export default function PreRegistered() {
  const [showModal, setShowModal] = useState(false);
  const [showQR, setShowQR] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [confirmResendId, setConfirmResendId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', phone: '', company: '',
    host_id: '', visitor_type_id: '', purpose: '', expected_date: '',
    expected_time_start: '', expected_time_end: ''
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const { data: preRegs, refetch } = useQuery('pre-registered', () =>
    api.get('/pre-registered').then(r => r.data),
    { refetchInterval: 30000 }
  );

  const { data: hosts } = useQuery('hosts-list', () =>
    api.get('/hosts').then(r => r.data)
  );

  const { data: visitorTypes } = useQuery('visitor-types-list', () =>
    api.get('/visitor-types').then(r => r.data)
  );

  // Frequent visitors — permanent QR badges (FV-XXXXX) for people who visit often
  const [showFVForm, setShowFVForm] = useState(false);
  const [fvForm, setFvForm] = useState({ first_name: '', last_name: '', email: '', phone: '', company: '', notes: '' });
  const [fvBusy, setFvBusy] = useState(false);
  const [fvBadge, setFvBadge] = useState(null); // row whose QR badge is on screen
  const [fvConfirmDelete, setFvConfirmDelete] = useState(null);

  const { data: frequentVisitors, refetch: refetchFV } = useQuery('frequent-visitors',
    () => api.get('/frequent-visitors').then(r => r.data),
    { retry: false }
  );

  const addFrequentVisitor = async () => {
    if (!fvForm.first_name.trim() || !fvForm.last_name.trim()) {
      toast('First and last name are required', 'error');
      return;
    }
    setFvBusy(true);
    try {
      await api.post('/frequent-visitors', fvForm);
      toast('Frequent visitor added');
      setFvForm({ first_name: '', last_name: '', email: '', phone: '', company: '', notes: '' });
      setShowFVForm(false);
      refetchFV();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to add frequent visitor', 'error');
    } finally {
      setFvBusy(false);
    }
  };

  const toggleFV = async (fv) => {
    try {
      await api.patch(`/frequent-visitors/${fv.id}`, { is_active: !fv.is_active });
      refetchFV();
    } catch (err) {
      toast('Failed to update badge', 'error');
    }
  };

  const deleteFV = async (id) => {
    try {
      await api.delete(`/frequent-visitors/${id}`);
      setFvConfirmDelete(null);
      refetchFV();
    } catch (err) {
      toast('Failed to delete', 'error');
    }
  };

  // Print a wallet-sized badge: QR of "FV:<code>" + name + code for manual entry
  const printFVBadge = (fv) => {
    const win = window.open('', '_blank', 'width=420,height=560');
    if (!win) return;
    const qrEl = document.getElementById(`fv-qr-${fv.id}`);
    const qrSvg = qrEl ? qrEl.innerHTML : '';
    win.document.write(`<!DOCTYPE html><html><head><title>Badge ${fv.code}</title>
      <style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
      .badge{border:3px solid #0D7377;border-radius:18px;padding:28px 32px;text-align:center;max-width:300px}
      .name{font-size:22px;font-weight:800;color:#0F172A;margin:14px 0 4px}
      .code{font-family:monospace;font-size:18px;font-weight:700;color:#0D7377;letter-spacing:2px}
      .hint{font-size:11px;color:#94A3B8;margin-top:10px}</style></head>
      <body><div class="badge">${qrSvg}
        <div class="name">${fv.first_name} ${fv.last_name}</div>
        <div class="code">${fv.code}</div>
        <div class="hint">Frequent visitor — scan at the kiosk to sign in or out</div>
      </div><script>window.onload=function(){window.print()}<\/script></body></html>`);
    win.document.close();
  };

  const { data: orgSettings } = useQuery('org-settings', () =>
    api.get('/settings').then(r => r.data)
  );
  // Dates are optional unless the org requires them (Settings > Pre-Registrations)
  const dateRequired = !!orgSettings?.require_prereg_date;

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
    if (dateRequired && !form.expected_date) newErrors.expected_date = 'Expected date is required by your organization';
    if (form.expected_time_start && form.expected_time_end && form.expected_time_end <= form.expected_time_start) {
      newErrors.expected_time_end = 'End time must be after start time';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setSubmitting(true);
    try {
      if (editingId) {
        await api.put(`/pre-registered/${editingId}`, form);
      } else {
        await api.post('/pre-registered', form);
      }
      closeModal();
      refetch();
      toast(editingId ? 'Pre-registration updated' : 'Visitor pre-registered — invitation sent');
    } catch (err) {
      const serverError = err.response?.data?.details || err.response?.data?.error || 'Failed to save';
      toast(serverError, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/pre-registered/${id}`);
      setConfirmDeleteId(null);
      refetch();
      toast('Pre-registration deleted');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to delete', 'error');
    }
  };

  const handleResend = async (id) => {
    try {
      await api.post(`/pre-registered/${id}/resend`);
      setConfirmResendId(null);
      toast('Invitation resent');
      refetch();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to resend', 'error');
    }
  };

  const openEdit = (pr) => {
    setEditingId(pr.id);
    setForm({
      first_name: pr.first_name, last_name: pr.last_name, email: pr.email,
      phone: pr.phone || '', company: pr.company || '', host_id: pr.host_id || '',
      visitor_type_id: pr.visitor_type_id || '', purpose: pr.purpose || '',
      expected_date: pr.expected_date ? pr.expected_date.split('T')[0] : '',
      expected_time_start: pr.expected_time_start || '',
      expected_time_end: pr.expected_time_end || ''
    });
    setErrors({});
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
    setForm({ first_name: '', last_name: '', email: '', phone: '', company: '', host_id: '', visitor_type_id: '', purpose: '', expected_date: '', expected_time_start: '', expected_time_end: '' });
    setErrors({});
  };

  const handleChange = (field, value) => {
    setForm({ ...form, [field]: value });
    if (errors[field]) setErrors({ ...errors, [field]: null });
  };

  const inputStyle = (field) => ({
    width: '100%', padding: '12px 16px', borderRadius: 10,
    border: `2px solid ${errors[field] ? '#EF4444' : '#E2E8F0'}`,
    fontSize: 14, outline: 'none', background: '#fff'
  });

  const errorStyle = { color: '#EF4444', fontSize: 12, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 };

  const statusColors = {
    pending: '#F59E0B', sent: '#0D7377', opened: '#3B82F6', used: '#10B981',
    checked_in: '#10B981', checked_out: '#64748B'
  };
  const statusLabels = {
    pending: 'pending', sent: 'sent', opened: 'opened', used: 'used',
    checked_in: 'in building', checked_out: 'checked out'
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0F172A' }}>Pre-Registered Visitors</h1>
          <p style={{ color: '#64748B', marginTop: 4 }}>Invite visitors ahead of time with QR codes</p>
        </div>
        <button onClick={() => { setEditingId(null); setForm({ first_name: '', last_name: '', email: '', phone: '', company: '', host_id: '', visitor_type_id: '', purpose: '', expected_date: '', expected_time_start: '', expected_time_end: '' }); setErrors({}); setShowModal(true); }}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 24px', borderRadius: 12, background: '#0D7377', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
          <Plus size={18} /> Pre-Register Visitor
        </button>
      </div>

      <div style={{ background: '#fff', borderRadius: 20, overflow: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#F8FAFC' }}>
              {['Visitor', 'Host', 'Date', 'Status', 'Actions'].map(h => (
                <th key={h} style={{ padding: '16px 20px', textAlign: 'left', fontSize: 13, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preRegs?.map(pr => (
              <tr key={pr.id} style={{ borderTop: '1px solid #E2E8F0' }}>
                <td style={{ padding: '16px 20px' }}>
                  <div style={{ fontWeight: 600, color: '#0F172A', fontSize: 14 }}>{pr.first_name} {pr.last_name}</div>
                  <div style={{ fontSize: 12, color: '#64748B' }}>{pr.email}</div>
                </td>
                <td style={{ padding: '16px 20px', fontSize: 14, color: '#334155' }}>
                  {pr.host_first_name} {pr.host_last_name}
                </td>
                <td style={{ padding: '16px 20px', fontSize: 13, color: '#64748B' }}>
                  {pr.expected_date ? new Date(pr.expected_date).toLocaleDateString() : 'Flexible'} {pr.expected_time_start || ''}
                </td>
                <td style={{ padding: '16px 20px' }}>
                  <span style={{
                    fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 20,
                    background: `${statusColors[pr.invitation_status] || '#64748B'}15`,
                    color: statusColors[pr.invitation_status] || '#64748B'
                  }}>
                    {statusLabels[pr.invitation_status] || pr.invitation_status}
                  </span>
                </td>
                <td style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => setShowQR(pr)} style={{ padding: 8, borderRadius: 8, background: '#F1F5F9', border: 'none', cursor: 'pointer' }} title="View QR">
                      <QrCode size={16} color="#64748B" />
                    </button>
                    <button onClick={() => openEdit(pr)} style={{ padding: 8, borderRadius: 8, background: '#F1F5F9', border: 'none', cursor: 'pointer' }} title="Edit">
                      <Pencil size={16} color="#64748B" />
                    </button>
                    {confirmResendId === pr.id ? (
                      <span style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => handleResend(pr.id)} style={{ padding: '8px 10px', borderRadius: 8, background: '#1E40AF', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                          Resend?
                        </button>
                        <button onClick={() => setConfirmResendId(null)} style={{ padding: '8px 10px', borderRadius: 8, background: '#F1F5F9', border: 'none', fontSize: 12, cursor: 'pointer' }}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmResendId(pr.id)} style={{ padding: 8, borderRadius: 8, background: '#DBEAFE', border: 'none', cursor: 'pointer' }} title="Resend Invitation">
                        <RefreshCw size={16} color="#1E40AF" />
                      </button>
                    )}
                    {confirmDeleteId === pr.id ? (
                      <span style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => handleDelete(pr.id)} style={{ padding: '8px 10px', borderRadius: 8, background: '#EF4444', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                          Confirm
                        </button>
                        <button onClick={() => setConfirmDeleteId(null)} style={{ padding: '8px 10px', borderRadius: 8, background: '#F1F5F9', border: 'none', fontSize: 12, cursor: 'pointer' }}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmDeleteId(pr.id)} style={{ padding: 8, borderRadius: 8, background: '#FEF2F2', border: 'none', cursor: 'pointer' }} title="Delete">
                        <Trash2 size={16} color="#EF4444" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="responsive-modal" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#fff', borderRadius: 20, padding: 32, width: '100%', maxWidth: 500, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 25px 80px rgba(0,0,0,0.3)' }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{editingId ? 'Edit' : 'Pre-Register'} Visitor</h2>
            <p style={{ color: '#64748B', fontSize: 14, marginBottom: 24 }}>Fields marked with <span style={{ color: '#EF4444' }}>*</span> are required</p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 6, display: 'block' }}>First Name <span style={{ color: '#EF4444' }}>*</span></label>
                  <input type="text" value={form.first_name} onChange={(e) => handleChange('first_name', e.target.value)} style={inputStyle('first_name')} />
                  {errors.first_name && <span style={errorStyle}><AlertCircle size={12} /> {errors.first_name}</span>}
                </div>
                <div>
                  <label style={{ fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 6, display: 'block' }}>Last Name <span style={{ color: '#EF4444' }}>*</span></label>
                  <input type="text" value={form.last_name} onChange={(e) => handleChange('last_name', e.target.value)} style={inputStyle('last_name')} />
                  {errors.last_name && <span style={errorStyle}><AlertCircle size={12} /> {errors.last_name}</span>}
                </div>
              </div>
              <div>
                <label style={{ fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 6, display: 'block' }}>Email <span style={{ color: '#EF4444' }}>*</span></label>
                <input type="email" value={form.email} onChange={(e) => handleChange('email', e.target.value)} style={inputStyle('email')} />
                {errors.email && <span style={errorStyle}><AlertCircle size={12} /> {errors.email}</span>}
              </div>
              <div>
                <label style={{ fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 6, display: 'block' }}>Phone</label>
                <input type="tel" value={form.phone} onChange={(e) => handleChange('phone', e.target.value)} style={inputStyle('phone')} />
              </div>
              <div>
                <label style={{ fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 6, display: 'block' }}>Company</label>
                <input type="text" value={form.company} onChange={(e) => handleChange('company', e.target.value)} style={inputStyle('company')} />
              </div>
              <div>
                <label style={{ fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 6, display: 'block' }}>Host <span style={{ color: '#EF4444' }}>*</span></label>
                <select value={form.host_id} onChange={(e) => handleChange('host_id', e.target.value)} style={inputStyle('host_id')}>
                  <option value="">Select a host</option>
                  {hosts?.map(h => <option key={h.id} value={h.id}>{h.first_name} {h.last_name}</option>)}
                </select>
                {errors.host_id && <span style={errorStyle}><AlertCircle size={12} /> {errors.host_id}</span>}
              </div>
              <div>
                <label style={{ fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 6, display: 'block' }}>Visitor Type <span style={{ color: '#EF4444' }}>*</span></label>
                <select value={form.visitor_type_id} onChange={(e) => handleChange('visitor_type_id', e.target.value)} style={inputStyle('visitor_type_id')}>
                  <option value="">Select visitor type</option>
                  {visitorTypes?.map(vt => <option key={vt.id} value={vt.id}>{vt.name}</option>)}
                </select>
                {errors.visitor_type_id && <span style={errorStyle}><AlertCircle size={12} /> {errors.visitor_type_id}</span>}
              </div>
              <div>
                <label style={{ fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 6, display: 'block' }}>Purpose</label>
                <input type="text" value={form.purpose} onChange={(e) => handleChange('purpose', e.target.value)} style={inputStyle('purpose')} />
              </div>
              <div>
                <label style={{ fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 6, display: 'block' }}>Expected Date {dateRequired ? <span style={{ color: '#EF4444' }}>*</span> : <span style={{ color: '#94A3B8', fontWeight: 400 }}>(optional)</span>}</label>
                <input type="date" value={form.expected_date} onChange={(e) => handleChange('expected_date', e.target.value)} style={inputStyle('expected_date')} />
                {errors.expected_date && <span style={errorStyle}><AlertCircle size={12} /> {errors.expected_date}</span>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 6, display: 'block' }}>Start Time <span style={{ color: '#94A3B8', fontWeight: 400 }}>(optional)</span></label>
                  <input type="time" value={form.expected_time_start} onChange={(e) => handleChange('expected_time_start', e.target.value)} style={inputStyle('expected_time_start')} />
                  {errors.expected_time_start && <span style={errorStyle}><AlertCircle size={12} /> {errors.expected_time_start}</span>}
                </div>
                <div>
                  <label style={{ fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 6, display: 'block' }}>End Time <span style={{ color: '#94A3B8', fontWeight: 400 }}>(optional)</span></label>
                  <input type="time" value={form.expected_time_end} onChange={(e) => handleChange('expected_time_end', e.target.value)} style={inputStyle('expected_time_end')} />
                  {errors.expected_time_end && <span style={errorStyle}><AlertCircle size={12} /> {errors.expected_time_end}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <button type="button" onClick={closeModal} style={{ flex: 1, padding: '14px', borderRadius: 10, background: '#F1F5F9', border: 'none', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                <button type="submit" disabled={submitting} style={{ flex: 1, padding: '14px', borderRadius: 10, background: submitting ? '#94A3B8' : '#0D7377', border: 'none', color: '#fff', fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer' }}>
                  {submitting ? 'Saving...' : (editingId ? 'Update' : 'Send Invitation')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QR Modal */}
      {showQR && (
        <div className="responsive-modal" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#fff', borderRadius: 20, padding: 32, textAlign: 'center', boxShadow: '0 25px 80px rgba(0,0,0,0.3)' }}>
            <h3 style={{ marginBottom: 16 }}>QR Code for {showQR.first_name} {showQR.last_name}</h3>
            <div style={{ padding: 20, background: '#F8FAFC', borderRadius: 16, marginBottom: 16 }}>
              <QRCodeSVG value={`${window.location.origin}/check-in/${showQR.qr_code}`} size={200} level="H" includeMargin={true} />
            </div>
            <p style={{ fontSize: 13, color: '#64748B', marginBottom: 16 }}>Scan this QR code or share the link below</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F1F5F9', padding: '12px 16px', borderRadius: 10, marginBottom: 16 }}>
              <input type="text" readOnly value={`${window.location.origin}/check-in/${showQR.qr_code}`} style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 13, outline: 'none' }} />
              <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/check-in/${showQR.qr_code}`); toast('Link copied'); }} style={{ padding: '6px 12px', borderRadius: 6, background: '#0D7377', border: 'none', color: '#fff', fontSize: 12, cursor: 'pointer' }}>
                <Copy size={14} /> Copy
              </button>
            </div>
            <button onClick={() => setShowQR(null)} style={{ padding: '12px 32px', borderRadius: 10, background: '#F1F5F9', border: 'none', fontWeight: 600, cursor: 'pointer' }}>Close</button>
          </div>
        </div>
      )}

      {/* ─── Frequent Visitors — permanent QR badges for regulars ─── */}
      <div style={{ marginTop: 36 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Star size={20} color="#F59E0B" /> Frequent Visitors
            </h2>
            <p style={{ color: '#64748B', marginTop: 4, fontSize: 14 }}>
              People who visit often get a permanent badge with a unique ID. One scan signs them in, the next signs them out — no typing.
            </p>
          </div>
          <button onClick={() => setShowFVForm(!showFVForm)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 10, background: '#F59E0B', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
            <Plus size={16} /> Add Frequent Visitor
          </button>
        </div>

        {showFVForm && (
          <div style={{ background: '#fff', borderRadius: 16, padding: 20, marginBottom: 16, boxShadow: '0 2px 10px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 12 }}>
              <input type="text" placeholder="First name *" value={fvForm.first_name} onChange={(e) => setFvForm({ ...fvForm, first_name: e.target.value })}
                style={{ padding: '11px 14px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14 }} />
              <input type="text" placeholder="Last name *" value={fvForm.last_name} onChange={(e) => setFvForm({ ...fvForm, last_name: e.target.value })}
                style={{ padding: '11px 14px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14 }} />
              <input type="email" placeholder="Email (recommended)" value={fvForm.email} onChange={(e) => setFvForm({ ...fvForm, email: e.target.value })}
                style={{ padding: '11px 14px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14 }} />
              <input type="text" placeholder="Phone" value={fvForm.phone} onChange={(e) => setFvForm({ ...fvForm, phone: e.target.value })}
                style={{ padding: '11px 14px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14 }} />
              <input type="text" placeholder="Company" value={fvForm.company} onChange={(e) => setFvForm({ ...fvForm, company: e.target.value })}
                style={{ padding: '11px 14px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14 }} />
              <input type="text" placeholder="Notes (staff only)" value={fvForm.notes} onChange={(e) => setFvForm({ ...fvForm, notes: e.target.value })}
                style={{ padding: '11px 14px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14 }} />
            </div>
            <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 12 }}>
              Email links the badge to their visits and to any watchlist flag — add it whenever you have it.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={addFrequentVisitor} disabled={fvBusy}
                style={{ padding: '11px 24px', borderRadius: 10, background: fvBusy ? '#94A3B8' : '#0D7377', border: 'none', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                {fvBusy ? 'Adding…' : 'Add & Generate Badge'}
              </button>
              <button onClick={() => setShowFVForm(false)}
                style={{ padding: '11px 20px', borderRadius: 10, background: '#F1F5F9', border: 'none', color: '#475569', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div style={{ background: '#fff', borderRadius: 20, overflow: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0' }}>
          {(frequentVisitors || []).length === 0 ? (
            <p style={{ padding: 32, textAlign: 'center', color: '#94A3B8', fontSize: 14 }}>No frequent visitors yet — add couriers, cleaning crews, or anyone who comes often.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#F8FAFC' }}>
                  {['Badge ID', 'Name', 'Contact', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '14px 20px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(frequentVisitors || []).map(fv => (
                  <tr key={fv.id} style={{ borderTop: '1px solid #E2E8F0', opacity: fv.is_active ? 1 : 0.55 }}>
                    <td style={{ padding: '14px 20px' }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 14, color: '#B45309', background: '#FEF3C7', padding: '4px 10px', borderRadius: 6 }}>
                        {fv.code}
                      </span>
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <div style={{ fontWeight: 600, color: '#0F172A', fontSize: 14 }}>{fv.first_name} {fv.last_name}</div>
                      {fv.company && <div style={{ fontSize: 12, color: '#64748B' }}>{fv.company}</div>}
                    </td>
                    <td style={{ padding: '14px 20px', fontSize: 13, color: '#64748B' }}>
                      {fv.email || '—'}{fv.phone ? ` · ${fv.phone}` : ''}
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <span style={{
                        fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 20,
                        background: fv.is_active ? '#DCFCE7' : '#F1F5F9',
                        color: fv.is_active ? '#166534' : '#64748B'
                      }}>
                        {fv.is_active ? 'Active' : 'Deactivated'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        {/* hidden QR used by the print view */}
                        <span id={`fv-qr-${fv.id}`} style={{ display: 'none' }}>
                          <QRCodeSVG value={`FV:${fv.code}`} size={220} level="H" includeMargin={true} />
                        </span>
                        <button onClick={() => setFvBadge(fv)} title="Show QR badge"
                          style={{ padding: '8px 10px', borderRadius: 8, background: '#F0FDFA', border: 'none', cursor: 'pointer' }}>
                          <QrCode size={15} color="#0D7377" />
                        </button>
                        <button onClick={() => printFVBadge(fv)} title="Print badge"
                          style={{ padding: '8px 10px', borderRadius: 8, background: '#F1F5F9', border: 'none', cursor: 'pointer' }}>
                          <Printer size={15} color="#475569" />
                        </button>
                        <button onClick={() => toggleFV(fv)}
                          style={{ padding: '8px 12px', borderRadius: 8, background: '#fff', border: '1px solid #E2E8F0', fontSize: 12, fontWeight: 700, color: '#475569', cursor: 'pointer' }}>
                          {fv.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                        {fvConfirmDelete === fv.id ? (
                          <>
                            <button onClick={() => deleteFV(fv.id)}
                              style={{ padding: '8px 12px', borderRadius: 8, background: '#DC2626', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                              Confirm?
                            </button>
                            <button onClick={() => setFvConfirmDelete(null)}
                              style={{ padding: '8px 10px', borderRadius: 8, background: '#F1F5F9', border: 'none', fontSize: 12, cursor: 'pointer', color: '#64748B' }}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button onClick={() => setFvConfirmDelete(fv.id)} title="Delete"
                            style={{ padding: '8px 10px', borderRadius: 8, background: '#fff', border: '1px solid #FECACA', cursor: 'pointer' }}>
                            <Trash2 size={14} color="#DC2626" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* FV badge modal */}
      {fvBadge && (
        <div className="responsive-modal" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}
          onClick={() => setFvBadge(null)}>
          <div style={{ background: '#fff', borderRadius: 20, padding: 32, textAlign: 'center', boxShadow: '0 25px 80px rgba(0,0,0,0.3)' }}
            onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: 4 }}>{fvBadge.first_name} {fvBadge.last_name}</h3>
            <div style={{ fontFamily: 'monospace', fontWeight: 800, color: '#B45309', fontSize: 16, marginBottom: 16 }}>{fvBadge.code}</div>
            <div style={{ padding: 20, background: '#F8FAFC', borderRadius: 16, marginBottom: 16 }}>
              <QRCodeSVG value={`FV:${fvBadge.code}`} size={200} level="H" includeMargin={true} />
            </div>
            <p style={{ fontSize: 13, color: '#64748B', marginBottom: 16 }}>Scan at the kiosk to sign in — scan again to sign out.</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button onClick={() => printFVBadge(fvBadge)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 24px', borderRadius: 10, background: '#0D7377', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                <Printer size={16} /> Print Badge
              </button>
              <button onClick={() => setFvBadge(null)} style={{ padding: '12px 24px', borderRadius: 10, background: '#F1F5F9', border: 'none', fontWeight: 600, cursor: 'pointer' }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
