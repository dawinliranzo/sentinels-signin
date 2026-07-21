import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { Search, Filter, Download, CheckCircle, XCircle, FileText, Eye, X } from 'lucide-react';
import api from '../utils/api';
import { toast } from '../utils/toast';

export default function Visits() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [fromFilter, setFromFilter] = useState(''); // datetime-local
  const [toFilter, setToFilter] = useState('');
  const [ndaView, setNdaView] = useState(null); // { loading, data, error, name }
  const [confirmOutId, setConfirmOutId] = useState(null); // 2-step checkout, no browser popups
  const [detailVisit, setDetailVisit] = useState(null);

  const openNda = async (visit) => {
    setNdaView({ loading: true, data: null, error: null, name: `${visit.visitor_first_name} ${visit.visitor_last_name}` });
    try {
      const r = await api.get(`/visits/${visit.id}/nda`);
      setNdaView({ loading: false, data: r.data, error: null, name: `${visit.visitor_first_name} ${visit.visitor_last_name}` });
    } catch (err) {
      setNdaView({ loading: false, data: null, error: err.response?.data?.error || 'Could not load the signed NDA', name: '' });
    }
  };

  const { data: visits, isLoading, refetch } = useQuery(
    ['visits', statusFilter, fromFilter, toFilter, search],
    () => {
      const p = new URLSearchParams();
      if (statusFilter !== 'all') p.set('status', statusFilter);
      if (fromFilter) p.set('from', new Date(fromFilter).toISOString());
      if (toFilter) p.set('to', new Date(toFilter).toISOString());
      if (search) p.set('search', search);
      return api.get(`/visits?${p.toString()}`).then(r => r.data);
    },
    { keepPreviousData: true }
  );

  const handleCheckOut = async (id) => {
    try {
      await api.post(`/visits/${id}/check-out`);
      setConfirmOutId(null);
      refetch();
    } catch (err) {
      toast('Failed to check out visitor', 'error');
    }
  };

  const exportCSV = () => {
    if (!visits?.length) return;
    const headers = ['Name', 'Email', 'Company', 'Host', 'Purpose', 'Badge', 'In', 'Out', 'Status'];
    const rows = visits.map(v => [
      `${v.visitor_first_name} ${v.visitor_last_name}`,
      v.visitor_email, v.visitor_company,
      `${v.host_first_name || ''} ${v.host_last_name || ''}`,
      v.purpose, v.badge_number,
      v.checked_in_at ? new Date(v.checked_in_at).toLocaleString() : '',
      v.checked_out_at ? new Date(v.checked_out_at).toLocaleString() : '',
      v.status
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `visits-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0F172A' }}>Visits</h1>
          <p style={{ color: '#64748B', marginTop: 4 }}>Manage and track all visitor activity</p>
        </div>
        <button onClick={exportCSV}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 20px', borderRadius: 10,
            background: '#0D7377', border: 'none', color: '#fff',
            fontWeight: 600, cursor: 'pointer', fontSize: 14
          }}>
          <Download size={18} /> Export CSV
        </button>
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap',
        background: '#fff', padding: '16px 20px', borderRadius: 16,
        boxShadow: '0 2px 10px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0'
      }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <Search size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
          <input
            type="text" placeholder="Search name, email, host, or badge…"
            value={search} onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '12px 16px 12px 44px', borderRadius: 10,
              border: '2px solid #E2E8F0', fontSize: 14, outline: 'none'
            }}
          />
        </div>
        <select
          value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: '12px 16px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14, background: '#fff' }}
        >
          <option value="all">All Status</option>
          <option value="checked_in">Checked In</option>
          <option value="checked_out">Checked Out</option>
        </select>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>From</label>
          <input
            type="datetime-local" value={fromFilter} onChange={(e) => setFromFilter(e.target.value)}
            style={{ padding: '11px 12px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 13 }}
          />
          <label style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>To</label>
          <input
            type="datetime-local" value={toFilter} onChange={(e) => setToFilter(e.target.value)}
            style={{ padding: '11px 12px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 13 }}
          />
          {(fromFilter || toFilter) && (
            <button onClick={() => { setFromFilter(''); setToFilter(''); }}
              style={{ padding: '8px 12px', borderRadius: 8, background: '#F1F5F9', border: 'none', fontSize: 12, cursor: 'pointer', color: '#64748B' }}>
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div style={{
        background: '#fff', borderRadius: 20, overflow: 'auto',
        boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#F8FAFC' }}>
              {['Visitor', 'Host', 'Badge', 'In', 'Out', 'Status', 'Actions'].map(h => (
                <th key={h} style={{ padding: '16px 20px', textAlign: 'left', fontSize: 13, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>Loading...</td></tr>
            ) : visits?.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>No visits found</td></tr>
            ) : visits?.map(v => (
              <tr key={v.id} style={{ borderTop: '1px solid #E2E8F0', transition: 'background 0.2s' }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#F8FAFC'}
                onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}
              >
                <td style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: 'linear-gradient(135deg, #0D7377, #14FFEC)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 12, color: '#fff'
                    }}>
                      {v.visitor_first_name?.[0]}{v.visitor_last_name?.[0]}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {v.photo_data ? (
                        <img src={v.photo_data} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#64748B', flexShrink: 0 }}>
                          {v.visitor_first_name?.[0]}{v.visitor_last_name?.[0]}
                        </div>
                      )}
                      <div>
                        <div style={{ fontWeight: 600, color: '#0F172A', fontSize: 14 }}>
                          {v.visitor_first_name} {v.visitor_last_name}
                        </div>
                        <div style={{ fontSize: 12, color: '#64748B' }}>{v.visitor_company || 'No company'}</div>
                      </div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '16px 20px', fontSize: 14, color: '#334155' }}>
                  {v.host_first_name} {v.host_last_name}
                </td>
                <td style={{ padding: '16px 20px' }}>
                  <span style={{
                    fontFamily: 'monospace', fontWeight: 700, fontSize: 14,
                    color: '#0D7377', background: '#E0F2F1', padding: '4px 10px', borderRadius: 6
                  }}>
                    {v.badge_number}
                  </span>
                </td>
                <td style={{ padding: '16px 20px', fontSize: 13, color: '#64748B' }}>
                  {v.checked_in_at ? new Date(v.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}
                </td>
                <td style={{ padding: '16px 20px', fontSize: 13, color: '#64748B' }}>
                  {v.checked_out_at ? new Date(v.checked_out_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}
                </td>
                <td style={{ padding: '16px 20px' }}>
                  <span style={{
                    fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 20,
                    background: v.status === 'checked_in' ? '#DCFCE7' : '#F1F5F9',
                    color: v.status === 'checked_in' ? '#166534' : '#64748B'
                  }}>
                    {v.status === 'checked_in' ? 'On Site' : 'Checked Out'}
                  </span>
                </td>
                <td style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button onClick={() => setDetailVisit(v)} title="View visit details"
                      style={{ padding: '8px 10px', borderRadius: 8, background: '#F1F5F9', border: 'none', cursor: 'pointer' }}>
                      <Eye size={15} color="#64748B" />
                    </button>
                    {v.nda_signed && (
                      <button onClick={() => openNda(v)} title="View signed NDA"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          padding: '8px 12px', borderRadius: 8,
                          background: '#ECFEFF', border: 'none', color: '#0D7377',
                          fontSize: 12, fontWeight: 700, cursor: 'pointer'
                        }}>
                        <FileText size={14} /> NDA
                      </button>
                    )}
                    {v.status === 'checked_in' && (
                      confirmOutId === v.id ? (
                        <>
                          <button onClick={() => handleCheckOut(v.id)}
                            style={{ padding: '8px 14px', borderRadius: 8, background: '#DC2626', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                            Confirm?
                          </button>
                          <button onClick={() => setConfirmOutId(null)}
                            style={{ padding: '8px 10px', borderRadius: 8, background: '#F1F5F9', border: 'none', fontSize: 12, cursor: 'pointer', color: '#64748B' }}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setConfirmOutId(v.id)}
                          style={{
                            padding: '8px 16px', borderRadius: 8,
                            background: '#FF6B35', border: 'none', color: '#fff',
                            fontSize: 12, fontWeight: 600, cursor: 'pointer'
                          }}
                        >
                          Check Out
                        </button>
                      )
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Visit details modal — everything captured at check-in, incl. custom fields + photo */}
      {detailVisit && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 480, boxShadow: '0 25px 80px rgba(0,0,0,0.3)', maxHeight: '90vh', overflowY: 'auto', position: 'relative' }}>
            <button onClick={() => setDetailVisit(null)} style={{ position: 'absolute', top: 16, right: 16, background: '#F1F5F9', border: 'none', borderRadius: 8, padding: 8, cursor: 'pointer' }}>
              <X size={16} />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
              {detailVisit.photo_data ? (
                <img src={detailVisit.photo_data} alt="" style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(135deg, #0D7377, #14FFEC)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 22, fontWeight: 700 }}>
                  {detailVisit.visitor_first_name?.[0]}{detailVisit.visitor_last_name?.[0]}
                </div>
              )}
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#0F172A' }}>{detailVisit.visitor_first_name} {detailVisit.visitor_last_name}</div>
                <div style={{ fontSize: 13, color: '#64748B' }}>Badge <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0D7377' }}>{detailVisit.badge_number}</span></div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                ['Email', detailVisit.visitor_email],
                ['Phone', detailVisit.visitor_phone],
                ['Company', detailVisit.visitor_company],
                ['Host', `${detailVisit.host_first_name || ''} ${detailVisit.host_last_name || ''}`.trim()],
                ['Purpose', detailVisit.purpose],
                ['Vehicle', detailVisit.vehicle_plate],
                ['Checked in', detailVisit.checked_in_at ? new Date(detailVisit.checked_in_at).toLocaleString() : null],
                ['Checked out', detailVisit.checked_out_at ? new Date(detailVisit.checked_out_at).toLocaleString() : null],
                ['Method', detailVisit.sign_in_method],
              ].filter(([, val]) => val).map(([label, val]) => (
                <div key={label} style={{ padding: '10px 12px', background: '#F8FAFC', borderRadius: 10 }}>
                  <div style={{ fontSize: 11, color: '#64748B', marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A', wordBreak: 'break-word' }}>{val}</div>
                </div>
              ))}
              {/* Custom registration fields for this org */}
              {detailVisit.custom_data && Object.entries(detailVisit.custom_data).filter(([, val]) => val !== '' && val != null).map(([key, val]) => (
                <div key={key} style={{ padding: '10px 12px', background: '#F0FDFA', borderRadius: 10 }}>
                  <div style={{ fontSize: 11, color: '#0D7377', marginBottom: 2 }}>{key}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A', wordBreak: 'break-word' }}>{typeof val === 'boolean' ? (val ? 'Yes' : 'No') : String(val)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Signed NDA viewer */}
      {ndaView && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }}>
          <div style={{
            background: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 520,
            boxShadow: '0 25px 80px rgba(0,0,0,0.3)', maxHeight: '90vh', overflowY: 'auto'
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Signed NDA</h2>
            {ndaView.loading && <p style={{ color: '#64748B' }}>Loading…</p>}
            {ndaView.error && <p style={{ color: '#DC2626' }}>{ndaView.error}</p>}
            {ndaView.data && (
              <>
                <p style={{ fontSize: 13, color: '#64748B', marginBottom: 16 }}>
                  Signed by <strong>{ndaView.data.signed_name}</strong> ({ndaView.name}) on{' '}
                  {new Date(ndaView.data.signed_at).toLocaleString()}
                </p>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>Document signed</div>
                <div style={{
                  background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12,
                  padding: '14px 16px', maxHeight: 200, overflowY: 'auto',
                  fontSize: 13, color: '#334155', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: 16
                }}>
                  {ndaView.data.document_text}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>Signature</div>
                <div style={{ border: '1px solid #E2E8F0', borderRadius: 12, overflow: 'hidden', marginBottom: 8 }}>
                  <img src={ndaView.data.signature_data} alt="Visitor signature" style={{ width: '100%', display: 'block' }} />
                </div>
                <div style={{ fontSize: 12, color: '#94A3B8' }}>
                  Typed name confirmation: <strong>{ndaView.data.signed_name}</strong>
                </div>
              </>
            )}
            <button onClick={() => setNdaView(null)}
              style={{
                width: '100%', marginTop: 20, padding: '13px', borderRadius: 10,
                background: '#F1F5F9', border: 'none', fontWeight: 600, cursor: 'pointer'
              }}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
