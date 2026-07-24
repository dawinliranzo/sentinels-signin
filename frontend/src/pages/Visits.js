import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { useSearchParams } from 'react-router-dom';
import { Search, Filter, Download, CheckCircle, XCircle, FileText, Eye, X, Flag, ShieldAlert, Trash2 } from 'lucide-react';
import api from '../utils/api';
import { toast } from '../utils/toast';

// Convert a Date to the "YYYY-MM-DDTHH:mm" format datetime-local inputs expect
const toLocalInput = (d) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// Read initial filters from the URL so Dashboard stat cards can deep-link here
// e.g. /visits?status=checked_in  ·  /visits?range=today  ·  /visits?range=week
function initialFilters(params) {
  const f = { status: 'all', from: '', to: '' };
  const status = params.get('status');
  if (status) f.status = status;
  const range = params.get('range');
  const now = new Date();
  if (range === 'today') {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    f.from = toLocalInput(start); f.to = toLocalInput(now);
  } else if (range === 'week') {
    const start = new Date(now.getTime() - 7 * 864e5);
    f.from = toLocalInput(start); f.to = toLocalInput(now);
  }
  return f;
}

export default function Visits() {
  const [searchParams] = useSearchParams();
  const openWatchlistFromUrl = searchParams.get('watchlist') === '1';
  const [init] = useState(() => initialFilters(searchParams));
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(init.status);
  const [fromFilter, setFromFilter] = useState(init.from); // datetime-local
  const [toFilter, setToFilter] = useState(init.to);
  const [ndaView, setNdaView] = useState(null); // { loading, data, error, name }
  const [confirmOutId, setConfirmOutId] = useState(null); // 2-step checkout, no browser popups
  const [detailVisit, setDetailVisit] = useState(null);
  // Visitor watchlist/blacklist (staff-only side notes)
  const [showWatchlist, setShowWatchlist] = useState(openWatchlistFromUrl);
  const [flagTarget, setFlagTarget] = useState(null); // { email, name } being flagged
  const [flagForm, setFlagForm] = useState({ severity: 'warning', note: '' });
  const [flagBusy, setFlagBusy] = useState(false);

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

  const { data: flags, refetch: refetchFlags } = useQuery(
    'visitor-flags',
    () => api.get('/flags').then(r => r.data),
    { retry: false, refetchInterval: 60000 }
  );
  // A flag matches a visit row when EITHER identity matches (email or exact name pair)
  const flagFor = (v) => (flags || []).find(f => {
    if (!f.is_active) return false;
    if (f.visitor_email && v.visitor_email && f.visitor_email.toLowerCase() === v.visitor_email.toLowerCase()) return true;
    return f.visitor_first_name && f.visitor_last_name
        && (f.visitor_first_name || '').toLowerCase() === (v.visitor_first_name || '').toLowerCase()
        && (f.visitor_last_name || '').toLowerCase() === (v.visitor_last_name || '').toLowerCase();
  });

  const saveFlag = async () => {
    if (!flagTarget) return;
    setFlagBusy(true);
    try {
      await api.post('/flags', {
        visitor_email: flagTarget.email || undefined,
        visitor_first_name: flagTarget.first_name,
        visitor_last_name: flagTarget.last_name,
        visitor_name: flagTarget.name,
        severity: flagForm.severity,
        note: flagForm.note,
      });
      toast('Visitor flag saved');
      setFlagTarget(null);
      setFlagForm({ severity: 'warning', note: '' });
      refetchFlags();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to save flag', 'error');
    } finally {
      setFlagBusy(false);
    }
  };

  const removeFlag = async (id) => {
    try {
      await api.delete(`/flags/${id}`);
      refetchFlags();
    } catch (err) {
      toast('Failed to remove flag', 'error');
    }
  };

  const toggleFlagActive = async (f) => {
    try {
      await api.patch(`/flags/${f.id}`, { is_active: !f.is_active });
      refetchFlags();
    } catch (err) {
      toast('Failed to update flag', 'error');
    }
  };

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
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={() => setShowWatchlist(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 20px', borderRadius: 10,
              background: '#fff', border: '2px solid #FECACA', color: '#B91C1C',
              fontWeight: 600, cursor: 'pointer', fontSize: 14
            }}>
            <ShieldAlert size={18} /> Watchlist
            {(flags || []).filter(f => f.is_active).length > 0 && (
              <span style={{ background: '#DC2626', color: '#fff', borderRadius: 20, fontSize: 11, fontWeight: 800, padding: '2px 8px' }}>
                {(flags || []).filter(f => f.is_active).length}
              </span>
            )}
          </button>
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
                    {(() => {
                      const existing = flagFor(v);
                      return (
                        <button
                          onClick={() => {
                            setFlagForm({ severity: existing?.severity || 'warning', note: existing?.note || '' });
                            setFlagTarget({
                              email: v.visitor_email || '',
                              first_name: v.visitor_first_name,
                              last_name: v.visitor_last_name,
                              name: `${v.visitor_first_name} ${v.visitor_last_name}`,
                            });
                          }}
                          title={existing ? `Flagged (${existing.severity}) — edit` : 'Add a staff note / flag this visitor'}
                          style={{ padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', background: existing ? (existing.severity === 'blacklist' ? '#FEE2E2' : '#FEF3C7') : '#F1F5F9' }}>
                          <Flag size={15} color={existing ? (existing.severity === 'blacklist' ? '#DC2626' : '#B45309') : '#64748B'} fill={existing ? 'currentColor' : 'none'} />
                        </button>
                      );
                    })()}
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

      {/* Flag editor — private staff note for this visitor (never shown on the kiosk) */}
      {flagTarget && (
        <div className="responsive-modal" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120, padding: 16 }}
          onClick={() => setFlagTarget(null)}>
          <div style={{ background: '#fff', borderRadius: 18, padding: 26, width: '100%', maxWidth: 440, boxShadow: '0 25px 80px rgba(0,0,0,0.3)' }}
            onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 17, fontWeight: 800, color: '#0F172A', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Flag size={18} color="#B45309" /> Flag {flagTarget.name}
            </h3>
            <p style={{ fontSize: 13, color: '#64748B', marginBottom: 16, lineHeight: 1.5 }}>
              Private side note for the security desk — e.g. "not welcome", "be careful with this visitor".
              It shows on this dashboard only, never on the kiosk. <strong>Blacklist</strong> refuses check-in at the door.
              {flagTarget.email
                ? ' This flag matches the email they type at the kiosk.'
                : ' No email on file — this flag matches the exact first + last name they type at the kiosk.'}
            </p>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 6 }}>Severity</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {[['info', '#0D7377', '#F0FDFA', '#99F6E4'], ['warning', '#B45309', '#FFFBEB', '#FDE68A'], ['blacklist', '#DC2626', '#FEF2F2', '#FECACA']].map(([sev, col, bg, brd]) => (
                <button key={sev} onClick={() => setFlagForm({ ...flagForm, severity: sev })}
                  style={{
                    flex: 1, padding: '10px 0', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer', textTransform: 'capitalize',
                    background: flagForm.severity === sev ? bg : '#F8FAFC',
                    border: `2px solid ${flagForm.severity === sev ? brd : '#E2E8F0'}`,
                    color: flagForm.severity === sev ? col : '#64748B'
                  }}>
                  {sev}
                </button>
              ))}
            </div>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 6 }}>Note (staff only)</label>
            <textarea value={flagForm.note} onChange={(e) => setFlagForm({ ...flagForm, note: e.target.value })}
              rows={3} placeholder="e.g. Escorted off site last month — do not admit alone"
              style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14, resize: 'vertical', fontFamily: 'inherit', marginBottom: 18 }} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setFlagTarget(null)}
                style={{ padding: '11px 20px', borderRadius: 10, background: '#F1F5F9', border: 'none', color: '#475569', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={saveFlag} disabled={flagBusy}
                style={{ padding: '11px 20px', borderRadius: 10, background: flagBusy ? '#94A3B8' : '#0D7377', border: 'none', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                {flagBusy ? 'Saving…' : 'Save flag'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Watchlist panel — every flagged visitor, with activate/deactivate/remove */}
      {showWatchlist && (
        <div className="responsive-modal" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120, padding: 16 }}
          onClick={() => setShowWatchlist(false)}>
          <div style={{ background: '#fff', borderRadius: 18, padding: 26, width: '100%', maxWidth: 620, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 25px 80px rgba(0,0,0,0.3)' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <h3 style={{ fontSize: 17, fontWeight: 800, color: '#0F172A', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShieldAlert size={19} color="#DC2626" /> Visitor Watchlist
              </h3>
              <button onClick={() => setShowWatchlist(false)} style={{ background: '#F1F5F9', border: 'none', borderRadius: 8, padding: 8, cursor: 'pointer' }}>
                <X size={16} color="#64748B" />
              </button>
            </div>
            <p style={{ fontSize: 13, color: '#64748B', marginBottom: 16, lineHeight: 1.5 }}>
              Flagged visitors appear on the dashboard when they check in. Blacklisted visitors are refused at the kiosk.
              To flag someone new, find any of their visits and tap the flag icon.
            </p>
            {(flags || []).length === 0 ? (
              <p style={{ fontSize: 14, color: '#94A3B8', textAlign: 'center', padding: '24px 0' }}>No flagged visitors yet.</p>
            ) : (flags || []).map(f => (
              <div key={f.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                padding: '12px 14px', borderRadius: 12, marginBottom: 8,
                background: f.is_active ? (f.severity === 'blacklist' ? '#FEF2F2' : '#FFFBEB') : '#F8FAFC',
                border: `1px solid ${f.is_active ? (f.severity === 'blacklist' ? '#FECACA' : '#FDE68A') : '#E2E8F0'}`,
                opacity: f.is_active ? 1 : 0.6
              }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: '#0F172A' }}>{f.visitor_name || f.visitor_email}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', borderRadius: 20, padding: '2px 10px',
                      background: f.severity === 'blacklist' ? '#DC2626' : f.severity === 'warning' ? '#F59E0B' : '#0D7377', color: '#fff'
                    }}>
                      {f.severity}
                    </span>
                    {!f.is_active && <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 700 }}>INACTIVE</span>}
                  </div>
                  {f.note && <div style={{ fontSize: 13, color: '#475569', marginTop: 3, lineHeight: 1.4 }}>{f.note}</div>}
                  <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 3 }}>
                    {[f.visitor_email, f.visitor_first_name && f.visitor_last_name ? `name: ${f.visitor_first_name} ${f.visitor_last_name}` : null].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
                <button onClick={() => toggleFlagActive(f)}
                  style={{ padding: '8px 14px', borderRadius: 8, background: '#fff', border: '1px solid #E2E8F0', fontSize: 12, fontWeight: 700, color: '#475569', cursor: 'pointer' }}>
                  {f.is_active ? 'Deactivate' : 'Reactivate'}
                </button>
                <button onClick={() => removeFlag(f.id)} title="Remove flag"
                  style={{ padding: '8px 10px', borderRadius: 8, background: '#fff', border: '1px solid #FECACA', cursor: 'pointer' }}>
                  <Trash2 size={14} color="#DC2626" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Visit details modal — everything captured at check-in, incl. custom fields + photo */}
      {detailVisit && (
        <div className="responsive-modal" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
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
        <div className="responsive-modal"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
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
