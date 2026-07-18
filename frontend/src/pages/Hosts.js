import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { Plus, Search, Mail, Phone, Pencil, Trash2, Bell } from 'lucide-react';
import api from '../utils/api';

export default function Hosts() {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '', department: '', job_title: '', notify_email: true, notify_sms: false });

  const { data: hosts, refetch } = useQuery('hosts', () =>
    api.get('/hosts').then(r => r.data)
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await api.put(`/hosts/${editing}`, form);
      } else {
        await api.post('/hosts', form);
      }
      setShowModal(false);
      setEditing(null);
      setForm({ first_name: '', last_name: '', email: '', phone: '', department: '', job_title: '', notify_email: true, notify_sms: false });
      refetch();
    } catch (err) {
      alert('Failed to save host');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this host?')) return;
    try {
      await api.delete(`/hosts/${id}`);
      refetch();
    } catch (err) {
      alert('Failed to delete');
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
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0F172A' }}>Hosts</h1>
          <p style={{ color: '#64748B', marginTop: 4 }}>Manage employees who receive visitors</p>
        </div>
        <button
          onClick={() => { setEditing(null); setForm({ first_name: '', last_name: '', email: '', phone: '', department: '', job_title: '', notify_email: true, notify_sms: false }); setShowModal(true); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 24px', borderRadius: 12,
            background: '#0D7377', border: 'none', color: '#fff',
            fontWeight: 600, cursor: 'pointer', fontSize: 14
          }}
        >
          <Plus size={18} /> Add Host
        </button>
      </div>

      <div style={{
        background: '#fff', borderRadius: 20, overflow: 'auto',
        boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#F8FAFC' }}>
              {['Name', 'Department', 'Contact', 'Notifications', 'Actions'].map(h => (
                <th key={h} style={{ padding: '16px 20px', textAlign: 'left', fontSize: 13, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hosts?.map(h => (
              <tr key={h.id} style={{ borderTop: '1px solid #E2E8F0' }}>
                <td style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: '50%',
                      background: 'linear-gradient(135deg, #0D7377, #14FFEC)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 14, color: '#fff'
                    }}>
                      {h.first_name[0]}{h.last_name[0]}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, color: '#0F172A', fontSize: 14 }}>{h.first_name} {h.last_name}</div>
                      <div style={{ fontSize: 12, color: '#64748B' }}>{h.job_title || 'No title'}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '16px 20px', fontSize: 14, color: '#334155' }}>{h.department || '-'}</td>
                <td style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748B' }}>
                      <Mail size={12} /> {h.email}
                    </span>
                    {h.phone && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748B' }}>
                        <Phone size={12} /> {h.phone}
                      </span>
                    )}
                  </div>
                </td>
                <td style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {h.notify_email && <span style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, background: '#DCFCE7', color: '#166534' }}>Email</span>}
                    {h.notify_sms && <span style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, background: '#DBEAFE', color: '#1E40AF' }}>SMS</span>}
                  </div>
                </td>
                <td style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { setEditing(h.id); setForm(h); setShowModal(true); }}
                      style={{ padding: 8, borderRadius: 8, background: '#F1F5F9', border: 'none', cursor: 'pointer' }}>
                      <Pencil size={16} color="#64748B" />
                    </button>
                    <button onClick={() => handleDelete(h.id)}
                      style={{ padding: 8, borderRadius: 8, background: '#FEF2F2', border: 'none', cursor: 'pointer' }}>
                      <Trash2 size={16} color="#EF4444" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }}>
          <div style={{
            background: '#fff', borderRadius: 20, padding: 32, width: '100%', maxWidth: 500,
            boxShadow: '0 25px 80px rgba(0,0,0,0.3)'
          }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>
              {editing ? 'Edit Host' : 'Add New Host'}
            </h2>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <input type="text" placeholder="Department" value={form.department}
                  onChange={(e) => setForm({...form, department: e.target.value})} style={inputStyle} />
                <input type="text" placeholder="Job Title" value={form.job_title}
                  onChange={(e) => setForm({...form, job_title: e.target.value})} style={inputStyle} />
              </div>
              <div style={{ display: 'flex', gap: 24, padding: '8px 0' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.notify_email}
                    onChange={(e) => setForm({...form, notify_email: e.target.checked})}
                    style={{ width: 20, height: 20 }} />
                  <span style={{ fontSize: 14, color: '#334155' }}>Email notifications</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.notify_sms}
                    onChange={(e) => setForm({...form, notify_sms: e.target.checked})}
                    style={{ width: 20, height: 20 }} />
                  <span style={{ fontSize: 14, color: '#334155' }}>SMS notifications</span>
                </label>
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <button type="button" onClick={() => setShowModal(false)}
                  style={{ flex: 1, padding: '14px', borderRadius: 10, background: '#F1F5F9', border: 'none', fontWeight: 600, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button type="submit"
                  style={{ flex: 1, padding: '14px', borderRadius: 10, background: '#0D7377', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                  {editing ? 'Update' : 'Add Host'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
