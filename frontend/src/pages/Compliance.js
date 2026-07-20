import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { FileCheck, Search, Eye, X } from 'lucide-react';
import api from '../utils/api';

// Compliance center — signed NDAs today; audit-style records live here
export default function Compliance() {
  const [search, setSearch] = useState('');
  const [view, setView] = useState(null); // { loading, data, error }

  const { data: records = [], isLoading, error } = useQuery(
    ['compliance-nda', search],
    () => api.get('/compliance/nda', { params: search ? { search } : {} }).then(r => r.data),
    { keepPreviousData: true }
  );

  const openRecord = async (id) => {
    setView({ loading: true, data: null, error: null });
    try {
      const r = await api.get(`/compliance/nda/${id}`);
      setView({ loading: false, data: r.data, error: null });
    } catch (err) {
      setView({ loading: false, data: null, error: err.response?.data?.error || 'Could not load the record' });
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0F172A' }}>Compliance</h1>
        <p style={{ color: '#64748B', marginTop: 4 }}>
          Signed documents for your records — every NDA a visitor signs on the kiosk is stored here with the exact text they agreed to
        </p>
      </div>

      {/* Search */}
      <div style={{
        background: '#fff', padding: 16, borderRadius: 16, marginBottom: 20,
        boxShadow: '0 2px 10px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0',
        display: 'flex', alignItems: 'center', gap: 12
      }}>
        <Search size={20} color="#64748B" />
        <input
          type="text" placeholder="Search by visitor, signed name, email, or badge…"
          value={search} onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, border: 'none', outline: 'none', fontSize: 14 }}
        />
      </div>

      {error && (
        <div style={{ padding: '14px 18px', borderRadius: 12, background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: 14, marginBottom: 16 }}>
          {error.response?.data?.error || 'Failed to load compliance records'}
        </div>
      )}

      {/* Records */}
      <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 2px 10px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <FileCheck size={20} color="#0D7377" />
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>Signed NDAs</h3>
          <span style={{ fontSize: 13, color: '#94A3B8' }}>({records.length})</span>
        </div>

        {isLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>Loading…</div>
        ) : records.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>
            {search ? 'No records match your search.' : 'No signed NDAs yet. Once NDA signing is required in Settings, every visitor signature lands here.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                {['Visitor', 'Signed As', 'Badge', 'Signed At', ''].map(h => (
                  <th key={h} style={{ padding: '12px 20px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <td style={{ padding: '14px 20px' }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#0F172A' }}>{r.visitor_name}</div>
                    <div style={{ fontSize: 12, color: '#64748B' }}>{r.visitor_email || '—'}</div>
                  </td>
                  <td style={{ padding: '14px 20px', fontSize: 14, color: '#334155' }}>{r.signed_name}</td>
                  <td style={{ padding: '14px 20px' }}>
                    {r.badge_number
                      ? <span style={{ padding: '3px 10px', borderRadius: 20, background: '#ECFEFF', color: '#0D7377', fontSize: 12, fontWeight: 700 }}>{r.badge_number}</span>
                      : <span style={{ color: '#94A3B8' }}>—</span>}
                  </td>
                  <td style={{ padding: '14px 20px', fontSize: 13, color: '#64748B' }}>{new Date(r.signed_at).toLocaleString()}</td>
                  <td style={{ padding: '14px 20px' }}>
                    <button onClick={() => openRecord(r.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, background: '#F0FDFA', border: 'none', color: '#0D7377', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                      <Eye size={14} /> View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Record viewer */}
      {view && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 560, boxShadow: '0 25px 80px rgba(0,0,0,0.3)', maxHeight: '90vh', overflowY: 'auto', position: 'relative' }}>
            <button onClick={() => setView(null)} style={{ position: 'absolute', top: 16, right: 16, background: '#F1F5F9', border: 'none', borderRadius: 8, padding: 8, cursor: 'pointer' }}>
              <X size={16} />
            </button>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Signed NDA</h2>
            {view.loading && <p style={{ color: '#64748B' }}>Loading…</p>}
            {view.error && <p style={{ color: '#DC2626' }}>{view.error}</p>}
            {view.data && (
              <>
                <p style={{ fontSize: 13, color: '#64748B', marginBottom: 16 }}>
                  Signed by <strong>{view.data.signed_name}</strong> ({view.data.visitor_name}{view.data.visitor_email ? ` · ${view.data.visitor_email}` : ''})<br />
                  {new Date(view.data.signed_at).toLocaleString()}
                </p>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>Document signed (exact text shown to the visitor)</div>
                <div style={{
                  background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12,
                  padding: '14px 16px', maxHeight: 220, overflowY: 'auto',
                  fontSize: 13, color: '#334155', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: 16
                }}>
                  {view.data.document_text}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>Signature</div>
                <div style={{ border: '1px solid #E2E8F0', borderRadius: 12, overflow: 'hidden', marginBottom: 8 }}>
                  <img src={view.data.signature_data} alt="Visitor signature" style={{ width: '100%', display: 'block' }} />
                </div>
                <div style={{ fontSize: 12, color: '#94A3B8' }}>
                  Typed name confirmation: <strong>{view.data.signed_name}</strong>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
