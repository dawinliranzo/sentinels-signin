import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { BarChart3, Download, CalendarDays, UserX, Users } from 'lucide-react';
import api from '../utils/api';

const csvDownload = (filename, headers, rows) => {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map(r => r.map(esc).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = filename;
  a.click();
};

const iso = (d) => d.toISOString().split('T')[0];

export default function Reports() {
  // Default range: last 30 days
  const today = new Date();
  const monthAgo = new Date(Date.now() - 30 * 864e5);
  const [from, setFrom] = useState(iso(monthAgo));
  const [to, setTo] = useState(iso(today));
  const [inactiveDays, setInactiveDays] = useState(7);

  const fromISO = new Date(from + 'T00:00:00').toISOString();
  const toISO = new Date(to + 'T23:59:59').toISOString();

  const frequency = useQuery(
    ['report-frequency', from, to],
    () => api.get(`/reports/visitor-frequency?from=${fromISO}&to=${toISO}`).then(r => r.data)
  );
  const attendance = useQuery(
    ['report-attendance', from, to],
    () => api.get(`/reports/daily-attendance?from=${fromISO}&to=${toISO}`).then(r => r.data)
  );
  const inactive = useQuery(
    ['report-inactive', inactiveDays],
    () => api.get(`/reports/inactive-hosts?days=${inactiveDays}`).then(r => r.data)
  );

  const card = { background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 2px 10px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0', marginBottom: 24 };
  const th = { padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' };
  const td = { padding: '10px 16px', fontSize: 13, color: '#334155', borderTop: '1px solid #F1F5F9' };
  const dlBtn = {
    display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8,
    background: '#0D7377', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer'
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0F172A' }}>Reports</h1>
        <p style={{ color: '#64748B', marginTop: 4 }}>Analytics for your organization — preview here, download as CSV</p>
      </div>

      {/* Date range shared by the first two reports */}
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <CalendarDays size={18} color="#0D7377" />
        <span style={{ fontSize: 14, fontWeight: 600, color: '#334155' }}>Range:</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
          style={{ padding: '10px 12px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 13 }} />
        <span style={{ color: '#64748B' }}>to</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
          style={{ padding: '10px 12px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 13 }} />
      </div>

      {/* Visitor frequency */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 8 }}>
            <BarChart3 size={18} color="#0D7377" /> Visitor frequency — visits per day
          </h3>
          <button onClick={() => csvDownload(`visitor-frequency-${from}_to_${to}.csv`,
            ['Date', 'Visitors', 'Staff', 'Total'],
            (frequency.data || []).map(r => [r.day, r.visitors, r.staff, r.total]))}
            style={dlBtn}>
            <Download size={14} /> CSV
          </button>
        </div>
        {frequency.isLoading ? <p style={{ color: '#64748B' }}>Loading…</p> : (frequency.data || []).length === 0 ? (
          <p style={{ color: '#64748B', fontSize: 14 }}>No visits in this range.</p>
        ) : (
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: '#F8FAFC' }}><th style={th}>Date</th><th style={th}>Visitors</th><th style={th}>Staff</th><th style={th}>Total</th></tr></thead>
              <tbody>
                {frequency.data.map(r => (
                  <tr key={r.day}>
                    <td style={td}>{new Date(r.day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                    <td style={td}>{r.visitors}</td><td style={td}>{r.staff}</td><td style={{ ...td, fontWeight: 700 }}>{r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Daily attendance (staff badge-ins) */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Users size={18} color="#0D7377" /> Daily attendance — staff badge sign-ins
          </h3>
          <button onClick={() => csvDownload(`staff-attendance-${from}_to_${to}.csv`,
            ['Name', 'Email', 'Date', 'Checked In', 'Checked Out', 'Hours On Site'],
            (attendance.data || []).map(r => [
              `${r.visitor_first_name} ${r.visitor_last_name}`, r.visitor_email,
              r.day, r.checked_in_at ? new Date(r.checked_in_at).toLocaleString() : '',
              r.checked_out_at ? new Date(r.checked_out_at).toLocaleString() : '', r.hours_on_site ?? '']))}
            style={dlBtn}>
            <Download size={14} /> CSV
          </button>
        </div>
        {attendance.isLoading ? <p style={{ color: '#64748B' }}>Loading…</p> : (attendance.data || []).length === 0 ? (
          <p style={{ color: '#64748B', fontSize: 14 }}>No staff sign-ins in this range.</p>
        ) : (
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: '#F8FAFC' }}><th style={th}>Name</th><th style={th}>In</th><th style={th}>Out</th><th style={th}>Hours</th></tr></thead>
              <tbody>
                {attendance.data.map((r, i) => (
                  <tr key={i}>
                    <td style={td}>{r.visitor_first_name} {r.visitor_last_name}</td>
                    <td style={td}>{r.checked_in_at ? new Date(r.checked_in_at).toLocaleString() : '—'}</td>
                    <td style={td}>{r.checked_out_at ? new Date(r.checked_out_at).toLocaleString() : '—'}</td>
                    <td style={td}>{r.hours_on_site ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Inactive hosts */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 8 }}>
            <UserX size={18} color="#0D7377" /> Hosts with no sign-in for
            <input type="number" min="1" max="365" value={inactiveDays}
              onChange={(e) => setInactiveDays(Math.min(Math.max(parseInt(e.target.value) || 7, 1), 365))}
              style={{ width: 64, padding: '6px 10px', borderRadius: 8, border: '2px solid #E2E8F0', fontSize: 14, textAlign: 'center' }} />
            days
          </h3>
          <button onClick={() => csvDownload(`inactive-hosts-${inactiveDays}d.csv`,
            ['Name', 'Email', 'Department', 'Last Sign In'],
            ((inactive.data?.hosts) || []).map(h => [
              `${h.first_name} ${h.last_name}`, h.email, h.department || '',
              h.last_sign_in ? new Date(h.last_sign_in).toLocaleString() : 'never']))}
            style={dlBtn}>
            <Download size={14} /> CSV
          </button>
        </div>
        {inactive.isLoading ? <p style={{ color: '#64748B' }}>Loading…</p> : (inactive.data?.hosts || []).length === 0 ? (
          <p style={{ color: '#047857', fontSize: 14, fontWeight: 600 }}>Everyone has signed in within {inactiveDays} days ✓</p>
        ) : (
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: '#F8FAFC' }}><th style={th}>Name</th><th style={th}>Email</th><th style={th}>Last sign-in</th></tr></thead>
              <tbody>
                {inactive.data.hosts.map(h => (
                  <tr key={h.id}>
                    <td style={td}>{h.first_name} {h.last_name}</td>
                    <td style={td}>{h.email}</td>
                    <td style={{ ...td, color: h.last_sign_in ? '#92400E' : '#991B1B', fontWeight: 600 }}>
                      {h.last_sign_in ? new Date(h.last_sign_in).toLocaleDateString() : 'never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
