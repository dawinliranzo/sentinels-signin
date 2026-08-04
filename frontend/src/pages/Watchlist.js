import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { ShieldAlert, Plus, X, Trash2, MapPin, Flag, Clock, UserCheck, Pencil } from 'lucide-react';
import api from '../utils/api';
import { toast } from '../utils/toast';

// Watchlist — the record keeper for flagged and blocked visitors.
// Two halves: the rules (who is flagged and why) and the encounter log
// (every time a flagged person actually showed up, when, and at which kiosk).

const SEV = {
  blacklist: { label: 'Blocked', bg: '#FEE2E2', fg: '#B91C1C', dot: '#DC2626' },
  warning:   { label: 'Warning', bg: '#FEF3C7', fg: '#B45309', dot: '#D97706' },
  info:      { label: 'Info', bg: '#EFF6FF', fg: '#1D4ED8', dot: '#3B82F6' },
};

export default function Watchlist() {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', severity: 'warning', note: '' });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [tab, setTab] = useState('records'); // records | log
  const [recordsFilter, setRecordsFilter] = useState('all'); // all | active
  const [logFilter, setLogFilter] = useState('all'); // all | onsite
  const [detail, setDetail] = useState(null); // flag object open in the person popup
  const [detailEdit, setDetailEdit] = useState({ note: '', severity: 'warning' });
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailConfirmDelete, setDetailConfirmDelete] = useState(false);

  const { data: flags, refetch: refetchFlags } = useQuery('watchlist-flags', () =>
    api.get('/flags').then(r => r.data)
  );
  const { data: hits, refetch: refetchHits } = useQuery('watchlist-hits', () =>
    api.get('/flags/hits').then(r => r.data).catch(() => [])
  );

  const refetchAll = () => { refetchFlags(); refetchHits(); };

  const activeFlags = (flags || []).filter(f => f.is_active);
  const onSiteNow = (hits || []).filter(h => h.status === 'checked_in');
  const visibleFlags = (flags || []).filter(f => recordsFilter === 'active' ? f.is_active : true);
  const visibleHits = (hits || []).filter(h => logFilter === 'onsite' ? h.status === 'checked_in' : true);

  // The stat cards act as shortcuts: tap one to jump to exactly the slice of
  // data it counts (they looked tappable but did nothing — now they do)
  const jumpTo = (card) => {
    if (card === 'active') { setTab('records'); setRecordsFilter('active'); }
    if (card === 'onsite') { setTab('log'); setLogFilter('onsite'); }
    if (card === 'records') { setTab('log'); setLogFilter('all'); }
  };

  // Person popup — every flag's full story: the rule itself plus every time
  // this person actually showed up (matched from the encounter log)
  const openDetail = (f) => {
    setDetail(f);
    setDetailEdit({ note: f.note || '', severity: f.severity || 'warning' });
    setDetailConfirmDelete(false);
  };
  const detailHits = detail ? (hits || []).filter(h => h.flag_id === detail.id) : [];

  const saveDetail = async () => {
    if (!detail) return;
    setDetailBusy(true);
    try {
      const r = await api.patch(`/flags/${detail.id}`, { note: detailEdit.note.trim(), severity: detailEdit.severity });
      setDetail(r.data);
      refetchAll();
      toast('Watchlist record updated');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to update', 'error');
    } finally {
      setDetailBusy(false);
    }
  };

  const addFlag = async (e) => {
    e.preventDefault();
    if (!form.first_name.trim() || !form.last_name.trim()) {
      toast('First and last name are required — name is how we match visitors without an email', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.post('/flags', {
        visitor_email: form.email.trim() || undefined,
        visitor_first_name: form.first_name.trim(),
        visitor_last_name: form.last_name.trim(),
        visitor_name: `${form.first_name.trim()} ${form.last_name.trim()}`,
        severity: form.severity,
        note: form.note.trim(),
      });
      toast('Added to the watchlist');
      setShowAdd(false);
      setForm({ first_name: '', last_name: '', email: '', severity: 'warning', note: '' });
      refetchAll();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to add to watchlist', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleFlag = async (f) => {
    try {
      await api.patch(`/flags/${f.id}`, { is_active: !f.is_active });
      refetchAll();
      toast(f.is_active ? 'Flag deactivated — they can sign in again' : 'Flag reactivated');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to update flag', 'error');
    }
  };

  const removeFlag = async (id) => {
    try {
      await api.delete(`/flags/${id}`);
      setConfirmDelete(null);
      refetchAll();
      toast('Removed from watchlist');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to remove', 'error');
    }
  };

  const thStyle = { padding: '14px 18px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' };
  const tdStyle = { padding: '14px 18px', fontSize: 14, color: '#334155' };
  const inputStyle = { width: '100%', padding: '12px 16px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14, outline: 'none' };
  const labelStyle = { display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 };

  const flagName = (f) => `${f.visitor_first_name || ''} ${f.visitor_last_name || ''}`.trim() || f.visitor_name || '—';

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 10 }}>
            <ShieldAlert size={26} color="#DC2626" /> Watchlist
          </h1>
          <p style={{ color: '#64748B', marginTop: 4, maxWidth: 560 }}>
            Flagged and blocked visitors, plus the full record of every time they showed up. Matching works by email <em>or</em> by name — no email needed to block someone.
          </p>
        </div>
        <button onClick={() => setShowAdd(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderRadius: 10, background: '#DC2626', border: 'none', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
          <Plus size={17} /> Add to Watchlist
        </button>
      </div>

      {/* Stats — also shortcuts: tap a card to see exactly what it counts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 24 }}>
        {[
          { label: 'Active flags', value: activeFlags.length, icon: Flag, color: '#DC2626', jump: 'active' },
          { label: 'Flagged on site now', value: onSiteNow.length, icon: UserCheck, color: '#B45309', jump: 'onsite' },
          { label: 'Encounter records', value: (hits || []).length, icon: Clock, color: '#0D7377', jump: 'records' },
        ].map(c => (
          <button key={c.label} onClick={() => jumpTo(c.jump)} title="Show these"
            style={{ background: '#fff', borderRadius: 14, padding: '16px 18px', border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', textAlign: 'left' }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: `${c.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <c.icon size={18} color={c.color} />
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', lineHeight: 1 }}>{c.value}</div>
              <div style={{ fontSize: 12, color: '#64748B', marginTop: 3 }}>{c.label}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Tabs + active filter chip (set by the stat cards) */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        {[['records', `Watchlist records (${(flags || []).length})`], ['log', `Encounter log (${(hits || []).length})`]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{
              padding: '9px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer',
              border: tab === key ? '2px solid #0D7377' : '2px solid #E2E8F0',
              background: tab === key ? '#F0FDFA' : '#fff',
              color: tab === key ? '#0D7377' : '#64748B'
            }}>
            {label}
          </button>
        ))}
        {tab === 'records' && recordsFilter === 'active' && (
          <button onClick={() => setRecordsFilter('all')}
            style={{ padding: '6px 12px', borderRadius: 20, background: '#FEE2E2', border: 'none', color: '#991B1B', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            Showing active only ×
          </button>
        )}
        {tab === 'log' && logFilter === 'onsite' && (
          <button onClick={() => setLogFilter('all')}
            style={{ padding: '6px 12px', borderRadius: 20, background: '#FEF3C7', border: 'none', color: '#B45309', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            On site now only ×
          </button>
        )}
      </div>

      {/* ── Watchlist records ── */}
      {tab === 'records' && (
        <div style={{ background: '#fff', borderRadius: 20, overflow: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                {['Person', 'Level', 'Reason / note', 'Added', 'Status', 'Actions'].map(h => <th key={h} style={thStyle}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {(flags || []).length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>
                  Nobody on the watchlist. Add someone above, or use the flag button on any visit.
                </td></tr>
              ) : visibleFlags.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>
                  No active flags right now — <button onClick={() => setRecordsFilter('all')} style={{ background: 'none', border: 'none', color: '#0D7377', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>show everything</button>
                </td></tr>
              ) : visibleFlags.map(f => {
                const sev = SEV[f.severity] || SEV.warning;
                return (
                  <tr key={f.id} style={{ borderTop: '1px solid #E2E8F0', opacity: f.is_active ? 1 : 0.55 }}>
                    <td style={tdStyle}>
                      {/* The person opens their full record — rule + every encounter */}
                      <button onClick={() => openDetail(f)}
                        style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }}>
                        <div style={{ fontWeight: 700, color: '#0D7377', textDecoration: 'underline', textUnderlineOffset: 3, fontSize: 14 }}>{flagName(f)}</div>
                        <div style={{ fontSize: 12, color: '#64748B' }}>
                          {[f.visitor_email, f.visitor_first_name && f.visitor_last_name ? 'name match' : null].filter(Boolean).join(' · ') || 'name match'}
                        </div>
                      </button>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 20, background: sev.bg, color: sev.fg, textTransform: 'uppercase' }}>
                        {sev.label}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, maxWidth: 260 }}>{f.note || <span style={{ color: '#94A3B8' }}>—</span>}</td>
                    <td style={{ ...tdStyle, fontSize: 13, whiteSpace: 'nowrap' }}>
                      {new Date(f.created_at).toLocaleDateString()}
                      {(f.created_by_first_name || f.created_by_last_name) && (
                        <div style={{ fontSize: 11, color: '#94A3B8' }}>by {f.created_by_first_name} {f.created_by_last_name}</div>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <button onClick={() => toggleFlag(f)}
                        style={{
                          padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none',
                          background: f.is_active ? '#DCFCE7' : '#E2E8F0', color: f.is_active ? '#166534' : '#475569'
                        }}>
                        {f.is_active ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td style={tdStyle}>
                      {confirmDelete === f.id ? (
                        <span style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => removeFlag(f.id)}
                            style={{ padding: '7px 12px', borderRadius: 8, background: '#EF4444', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                            Confirm
                          </button>
                          <button onClick={() => setConfirmDelete(null)}
                            style={{ padding: '7px 12px', borderRadius: 8, background: '#F1F5F9', border: 'none', fontSize: 12, cursor: 'pointer' }}>
                            Keep
                          </button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmDelete(f.id)} title="Remove from watchlist"
                          style={{ padding: 8, borderRadius: 8, background: '#FEF2F2', border: 'none', cursor: 'pointer' }}>
                          <Trash2 size={15} color="#991B1B" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Encounter log ── */}
      {tab === 'log' && (
        <div style={{ background: '#fff', borderRadius: 20, overflow: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                {['Visitor', 'Matched rule', 'When', 'Location', 'Badge', 'Status'].map(h => <th key={h} style={thStyle}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {(hits || []).length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>
                  No encounters recorded yet — when a flagged person signs in, it appears here.
                </td></tr>
              ) : visibleHits.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>
                  Nobody flagged is on site right now — <button onClick={() => setLogFilter('all')} style={{ background: 'none', border: 'none', color: '#0D7377', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>show the full log</button>
                </td></tr>
              ) : visibleHits.map((h, i) => {
                const sev = SEV[h.severity] || SEV.warning;
                return (
                  <tr key={`${h.visit_id}-${h.flag_id}-${i}`} style={{ borderTop: '1px solid #E2E8F0' }}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 700, color: '#0F172A' }}>{h.visitor_first_name} {h.visitor_last_name}</div>
                      <div style={{ fontSize: 12, color: '#64748B' }}>{h.visitor_email || h.visitor_company || ''}</div>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 20, background: sev.bg, color: sev.fg, textTransform: 'uppercase' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: sev.dot }} /> {sev.label}
                      </span>
                      {!h.flag_active && <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 3 }}>(rule now inactive)</div>}
                      {h.flag_note && <div style={{ fontSize: 12, color: '#64748B', marginTop: 3, maxWidth: 220 }}>{h.flag_note}</div>}
                    </td>
                    <td style={{ ...tdStyle, fontSize: 13, whiteSpace: 'nowrap' }}>
                      {new Date(h.checked_in_at).toLocaleString()}
                      {h.checked_out_at && <div style={{ fontSize: 11, color: '#94A3B8' }}>out {new Date(h.checked_out_at).toLocaleTimeString()}</div>}
                    </td>
                    <td style={{ ...tdStyle, fontSize: 13, whiteSpace: 'nowrap' }}>
                      {h.device_name ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#EFF6FF', color: '#1D4ED8', padding: '3px 10px', borderRadius: 6, fontWeight: 600 }}>
                          <MapPin size={12} /> {h.device_name}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: '#0D7377', background: '#E0F2F1', padding: '3px 9px', borderRadius: 6 }}>
                        {h.badge_number || '—'}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 20, textTransform: 'uppercase',
                        background: h.status === 'checked_in' ? '#DCFCE7' : '#F1F5F9',
                        color: h.status === 'checked_in' ? '#166534' : '#64748B'
                      }}>
                        {h.status === 'checked_in' ? 'On site' : 'Left'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Add modal ── */}
      {showAdd && (
        <div className="responsive-modal" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120, padding: 16 }}
          onClick={() => setShowAdd(false)}>
          <div style={{ background: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 440, boxShadow: '0 25px 80px rgba(0,0,0,0.3)', position: 'relative' }}
            onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setShowAdd(false)} style={{ position: 'absolute', top: 16, right: 16, background: '#F1F5F9', border: 'none', borderRadius: 8, padding: 8, cursor: 'pointer' }}>
              <X size={16} />
            </button>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', marginBottom: 4 }}>Add to Watchlist</h2>
            <p style={{ fontSize: 13, color: '#64748B', marginBottom: 18 }}>
              The name alone is enough — the kiosk blocks on name match even when the person gives no email, or a different one.
            </p>
            <form onSubmit={addFlag} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 140px' }}>
                  <label style={labelStyle}>First name *</label>
                  <input style={inputStyle} value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required />
                </div>
                <div style={{ flex: '1 1 140px' }}>
                  <label style={labelStyle}>Last name *</label>
                  <input style={inputStyle} value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} required />
                </div>
              </div>
              <div>
                <label style={labelStyle}>Email (optional — extra match)</label>
                <input type="email" style={inputStyle} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Only if known" />
              </div>
              <div>
                <label style={labelStyle}>Level</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[['warning', 'Warning — alert staff'], ['blacklist', 'Blocked — deny entry']].map(([val, label]) => (
                    <button type="button" key={val} onClick={() => setForm({ ...form, severity: val })}
                      style={{
                        flex: 1, padding: '10px 12px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        border: form.severity === val ? `2px solid ${SEV[val].dot}` : '2px solid #E2E8F0',
                        background: form.severity === val ? SEV[val].bg : '#fff',
                        color: form.severity === val ? SEV[val].fg : '#64748B'
                      }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label style={labelStyle}>Reason / note (staff only — never shown at the kiosk)</label>
                <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. Removed from premises on Jan 12 — do not admit" />
              </div>
              <button type="submit" disabled={busy}
                style={{ padding: '13px 20px', borderRadius: 10, background: '#DC2626', border: 'none', color: '#fff', fontWeight: 700, fontSize: 14, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1 }}>
                {busy ? 'Saving…' : 'Add to Watchlist'}
              </button>
            </form>
          </div>
        </div>
      )}
      {/* ── Person detail popup: the rule + every encounter, editable in place ── */}
      {detail && (() => {
        const sev = SEV[detail.severity] || SEV.warning;
        return (
          <div className="responsive-modal" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120, padding: 16 }}
            onClick={() => setDetail(null)}>
            <div style={{ background: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 520, boxShadow: '0 25px 80px rgba(0,0,0,0.3)', position: 'relative', maxHeight: '88vh', overflowY: 'auto' }}
              onClick={(e) => e.stopPropagation()}>
              <button onClick={() => setDetail(null)} style={{ position: 'absolute', top: 16, right: 16, background: '#F1F5F9', border: 'none', borderRadius: 8, padding: 8, cursor: 'pointer' }}>
                <X size={16} />
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: sev.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18, color: sev.fg, flexShrink: 0 }}>
                  {flagName(detail).split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A' }}>{flagName(detail)}</div>
                  <div style={{ fontSize: 13, color: '#64748B' }}>{detail.visitor_email || 'matched by name'}</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, margin: '14px 0 20px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 800, padding: '4px 12px', borderRadius: 20, background: sev.bg, color: sev.fg, textTransform: 'uppercase' }}>{sev.label}</span>
                <span style={{ fontSize: 11, fontWeight: 800, padding: '4px 12px', borderRadius: 20, background: detail.is_active ? '#DCFCE7' : '#E2E8F0', color: detail.is_active ? '#166534' : '#475569', textTransform: 'uppercase' }}>
                  {detail.is_active ? 'Active' : 'Inactive'}
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 20, background: '#F8FAFC', color: '#64748B' }}>
                  Added {new Date(detail.created_at).toLocaleDateString()}
                  {(detail.created_by_first_name || detail.created_by_last_name) ? ` by ${detail.created_by_first_name || ''} ${detail.created_by_last_name || ''}`.trim() : ''}
                </span>
              </div>

              {/* Edit in place — no delete-and-recreate for a wording change */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 8 }}>
                <Pencil size={14} color="#0D7377" /> Edit this record
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                {[['warning', 'Warning'], ['blacklist', 'Blocked'], ['info', 'Info']].map(([val, label]) => (
                  <button key={val} type="button" onClick={() => setDetailEdit({ ...detailEdit, severity: val })}
                    style={{
                      flex: 1, padding: '9px 10px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      border: detailEdit.severity === val ? `2px solid ${SEV[val].dot}` : '2px solid #E2E8F0',
                      background: detailEdit.severity === val ? SEV[val].bg : '#fff',
                      color: detailEdit.severity === val ? SEV[val].fg : '#64748B'
                    }}>
                    {label}
                  </button>
                ))}
              </div>
              <textarea value={detailEdit.note} onChange={(e) => setDetailEdit({ ...detailEdit, note: e.target.value })}
                placeholder="Reason / note (staff only — never shown at the kiosk)"
                style={{ width: '100%', padding: '12px 16px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14, outline: 'none', minHeight: 70, resize: 'vertical', boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 10, marginBottom: 20 }}>
                <button onClick={saveDetail} disabled={detailBusy}
                  style={{ flex: 1, padding: '11px 16px', borderRadius: 10, background: '#0D7377', border: 'none', color: '#fff', fontWeight: 700, fontSize: 13, cursor: detailBusy ? 'wait' : 'pointer', opacity: detailBusy ? 0.7 : 1 }}>
                  {detailBusy ? 'Saving…' : 'Save changes'}
                </button>
                <button onClick={async () => { await toggleFlag(detail); setDetail({ ...detail, is_active: !detail.is_active }); }}
                  style={{ padding: '11px 16px', borderRadius: 10, background: detail.is_active ? '#FEF3C7' : '#DCFCE7', border: 'none', color: detail.is_active ? '#B45309' : '#166534', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                  {detail.is_active ? 'Deactivate' : 'Reactivate'}
                </button>
                {detailConfirmDelete ? (
                  <button onClick={async () => { await removeFlag(detail.id); setDetail(null); }}
                    style={{ padding: '11px 16px', borderRadius: 10, background: '#EF4444', border: 'none', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                    Confirm remove
                  </button>
                ) : (
                  <button onClick={() => setDetailConfirmDelete(true)}
                    style={{ padding: '11px 14px', borderRadius: 10, background: '#FEF2F2', border: 'none', color: '#991B1B', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                    <Trash2 size={15} />
                  </button>
                )}
              </div>

              {/* Encounter history for exactly this person */}
              <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 8 }}>
                Encounters ({detailHits.length})
              </div>
              {detailHits.length === 0 ? (
                <div style={{ fontSize: 13, color: '#94A3B8', background: '#F8FAFC', borderRadius: 10, padding: '14px 16px' }}>
                  This person hasn't shown up since being flagged.
                </div>
              ) : detailHits.map((h, i) => (
                <div key={`${h.visit_id}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, background: '#F8FAFC', borderRadius: 10, padding: '12px 16px', marginBottom: 8, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>{new Date(h.checked_in_at).toLocaleString()}</div>
                    <div style={{ fontSize: 12, color: '#64748B' }}>
                      {h.device_name ? `at ${h.device_name}` : 'kiosk'}{h.badge_number ? ` · badge ${h.badge_number}` : ''}
                      {h.checked_out_at ? ` · out ${new Date(h.checked_out_at).toLocaleTimeString()}` : ''}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, textTransform: 'uppercase',
                    background: h.status === 'checked_in' ? '#DCFCE7' : '#E2E8F0',
                    color: h.status === 'checked_in' ? '#166534' : '#64748B'
                  }}>
                    {h.status === 'checked_in' ? 'On site' : 'Left'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
