import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { useNavigate } from 'react-router-dom';
import {
  Users, LogIn, Clock, Building2, TrendingUp,
  ArrowUpRight, Bell, Calendar, Download, X,
  ShieldAlert, UserX, Timer
} from 'lucide-react';
import api from '../utils/api';
import { toast } from '../utils/toast';
import { useStore } from '../utils/store';

const EXPORT_TYPES = [
  { key: 'visits', label: 'Visits Log', desc: 'Full visitor sign-in records for a date range' },
  { key: 'frequency', label: 'Visitor Frequency', desc: 'Daily totals: visitors, staff and overall counts' },
  { key: 'attendance', label: 'Staff Attendance', desc: 'Staff sign-ins with time on site per day' },
];

const RANGES = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'all', label: 'All time (up to 500 rows)' },
];

function rangeToDates(rangeKey) {
  const now = new Date();
  if (rangeKey === 'today') {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    return { from: start.toISOString(), to: now.toISOString() };
  }
  if (rangeKey === '7d' || rangeKey === '30d') {
    const days = rangeKey === '7d' ? 7 : 30;
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return { from: start.toISOString(), to: now.toISOString() };
  }
  return {}; // all time — no params
}

export default function Dashboard() {
  const navigate = useNavigate();
  const org = useStore((s) => s.organization);
  const [showEvac, setShowEvac] = useState(false);
  const [evacList, setEvacList] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [exportType, setExportType] = useState('visits');
  const [exportRange, setExportRange] = useState('7d');

  const openEvacuation = async () => {
    try {
      const res = await api.get('/visits/active');
      setEvacList(res.data);
      setShowEvac(true);
    } catch (err) {
      toast('Failed to load evacuation list', 'error');
    }
  };

  const downloadCsv = (filename, header, rows) => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [header.join(',')];
    rows.forEach(r => lines.push(r.map(esc).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const runExport = async () => {
    setExporting(true);
    try {
      const { from, to } = rangeToDates(exportRange);
      const stamp = new Date().toISOString().slice(0, 10);

      if (exportType === 'visits') {
        const params = new URLSearchParams();
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        const res = await api.get(`/visits?${params.toString()}`);
        downloadCsv(
          `visits-${exportRange}-${stamp}.csv`,
          ['First Name', 'Last Name', 'Email', 'Phone', 'Company', 'Purpose', 'Badge', 'Method', 'Status', 'Checked In', 'Checked Out'],
          res.data.map(v => [
            v.visitor_first_name, v.visitor_last_name, v.visitor_email, v.visitor_phone, v.visitor_company,
            v.purpose, v.badge_number, v.sign_in_method, v.status,
            v.checked_in_at ? new Date(v.checked_in_at).toLocaleString() : '',
            v.checked_out_at ? new Date(v.checked_out_at).toLocaleString() : ''
          ])
        );
      } else if (exportType === 'frequency') {
        const params = new URLSearchParams();
        params.set('from', from ? from.slice(0, 10) : '2020-01-01');
        if (to) params.set('to', to.slice(0, 10));
        const res = await api.get(`/reports/visitor-frequency?${params.toString()}`);
        downloadCsv(
          `visitor-frequency-${exportRange}-${stamp}.csv`,
          ['Date', 'Visitors', 'Staff', 'Total'],
          res.data.map(r => [r.day, r.visitors, r.staff, r.total])
        );
      } else {
        const params = new URLSearchParams();
        params.set('from', from ? from.slice(0, 10) : '2020-01-01');
        if (to) params.set('to', to.slice(0, 10));
        const res = await api.get(`/reports/daily-attendance?${params.toString()}`);
        downloadCsv(
          `staff-attendance-${exportRange}-${stamp}.csv`,
          ['Staff Member', 'Email', 'Date', 'Signed In', 'Signed Out', 'Hours On Site'],
          res.data.map(r => [
            `${r.visitor_first_name || ''} ${r.visitor_last_name || ''}`.trim(), r.visitor_email, r.day,
            r.checked_in_at ? new Date(r.checked_in_at).toLocaleString() : '',
            r.checked_out_at ? new Date(r.checked_out_at).toLocaleString() : '',
            r.hours_on_site ?? ''
          ])
        );
      }
      setShowExport(false);
      toast('Export downloaded', 'success');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to export', 'error');
    } finally {
      setExporting(false);
    }
  };

  const printEvacuation = () => {
    const orgName = org?.name || 'Organization';
    const now = new Date().toLocaleString();
    const rows = evacList.map(v =>
      `<tr><td style="padding:8px;border:1px solid #ccc">${v.visitor_first_name} ${v.visitor_last_name}</td><td style="padding:8px;border:1px solid #ccc">${v.visitor_company || ''}</td><td style="padding:8px;border:1px solid #ccc">${v.host_first_name ? v.host_first_name + ' ' + v.host_last_name : ''}</td><td style="padding:8px;border:1px solid #ccc">${v.badge_number || ''}</td><td style="padding:8px;border:1px solid #ccc">${v.checked_in_at ? new Date(v.checked_in_at).toLocaleTimeString() : ''}</td></tr>`
    ).join('');
    const win = window.open('', '_blank', 'width=700,height=600');
    win.document.write(`<!doctype html><html><head><title>Evacuation List</title></head><body style="font-family:Arial;padding:24px">
      <h2 style="margin:0">${orgName} — Evacuation List</h2>
      <p style="color:#555">${now} · ${evacList.length} people on site</p>
      <table style="border-collapse:collapse;width:100%"><thead><tr>
      <th style="text-align:left;padding:8px;border:1px solid #ccc">Visitor</th><th style="text-align:left;padding:8px;border:1px solid #ccc">Company</th><th style="text-align:left;padding:8px;border:1px solid #ccc">Host</th><th style="text-align:left;padding:8px;border:1px solid #ccc">Badge</th><th style="text-align:left;padding:8px;border:1px solid #ccc">Checked In</th>
      </tr></thead><tbody>${rows}</tbody></table>
      <script>window.onload=function(){window.print()}<\/script></body></html>`);
    win.document.close();
  };

  const { data: stats, isLoading } = useQuery('dashboard-stats', () =>
    api.get('/dashboard/stats').then(r => r.data)
  );

  // Security feeds — refresh every minute so the guard desk stays current
  const { data: alerts } = useQuery('alerts-today', () =>
    api.get('/visits/alerts/today').then(r => r.data),
    { refetchInterval: 60000, retry: false }
  );
  const { data: activeVisits } = useQuery('active-visits', () =>
    api.get('/visits/active').then(r => r.data),
    { refetchInterval: 60000, retry: false }
  );

  // Visitors on site longer than the org's overstay threshold (default 8h)
  const overstayHours = stats?.overstay_hours || 8;
  const overstaying = (activeVisits || []).filter(v =>
    (Date.now() - new Date(v.checked_in_at).getTime()) > overstayHours * 3600000
  );
  const flaggedToday = alerts?.flagged || [];
  const staffAlerts = alerts?.staff || [];
  const hasAlerts = flaggedToday.length > 0 || staffAlerts.length > 0 || overstaying.length > 0;

  const statCards = [
    { title: 'Active Visitors', value: stats?.active_visitors || 0, icon: Users, color: '#0D7377', link: '/visits?status=checked_in' },
    { title: "Today's Visits", value: stats?.today_visits || 0, icon: LogIn, color: '#FF6B35', link: '/visits?range=today' },
    { title: 'Weekly Visits', value: stats?.weekly_visits || 0, icon: Calendar, color: '#9B59B6', link: '/visits?range=week' },
    { title: 'Active Hosts', value: stats?.active_hosts || 0, icon: Building2, color: '#2ECC71', link: '/hosts' },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 800, color: '#0F172A', marginBottom: 4 }}>
            Dashboard
          </h1>
          <p style={{ color: '#64748B', fontSize: 15 }}>
            Overview of your visitor activity
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={() => navigate('/pre-registered')}
            style={{
              padding: '12px 24px', borderRadius: 12,
              background: '#0D7377', border: 'none', color: '#fff',
              fontWeight: 600, cursor: 'pointer', fontSize: 14,
              display: 'flex', alignItems: 'center', gap: 8
            }}
          >
            <Calendar size={18} /> Pre-Register Visitor
          </button>
          <button
            onClick={() => window.open(org?.id ? `/kiosk?org=${org.id}` : '/kiosk', '_blank')}
            style={{
              padding: '12px 24px', borderRadius: 12,
              background: '#FF6B35', border: 'none', color: '#fff',
              fontWeight: 600, cursor: 'pointer', fontSize: 14,
              display: 'flex', alignItems: 'center', gap: 8
            }}
          >
            Open Kiosk
          </button>
        </div>
      </div>

      {/* Stats Grid — clickable */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20, marginBottom: 32 }}>
        {statCards.map((card, i) => (
          <div
            key={i}
            onClick={() => navigate(card.link)}
            title={`View ${card.title.toLowerCase()}`}
            style={{
              background: '#fff', borderRadius: 20, padding: 24, cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0',
              transition: 'all 0.15s'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = card.color; e.currentTarget.style.transform = 'translateY(-2px)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.transform = 'none'; }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 14,
                background: `${card.color}15`, display: 'flex',
                alignItems: 'center', justifyContent: 'center'
              }}>
                <card.icon size={24} color={card.color} />
              </div>
              <ArrowUpRight size={18} color="#94A3B8" />
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, color: '#0F172A', marginBottom: 4 }}>
              {isLoading ? '...' : card.value}
            </div>
            <div style={{ fontSize: 14, color: '#64748B' }}>{card.title}</div>
          </div>
        ))}
      </div>

      {/* Security Alerts — watchlist/blacklist arrivals, staff notes, overstays */}
      {hasAlerts && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <ShieldAlert size={20} color="#DC2626" />
            <h3 style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', margin: 0 }}>Security Alerts</h3>
            <span style={{ fontSize: 12, fontWeight: 700, background: '#FEE2E2', color: '#991B1B', borderRadius: 20, padding: '3px 12px' }}>
              {flaggedToday.length + staffAlerts.length + overstaying.length}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
            {/* Flagged visitors on site / arrived today (watchlist + blacklist) */}
            {flaggedToday.length > 0 && (
              <div style={{ background: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '2px solid #FECACA' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <UserX size={18} color="#DC2626" />
                  <span style={{ fontSize: 15, fontWeight: 800, color: '#991B1B' }}>Flagged Visitors</span>
                </div>
                {flaggedToday.slice(0, 5).map((f, i) => (
                  <div key={i} style={{ padding: '10px 12px', borderRadius: 10, marginBottom: 8, background: f.severity === 'blacklist' ? '#FEF2F2' : '#FFFBEB', border: `1px solid ${f.severity === 'blacklist' ? '#FECACA' : '#FDE68A'}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: '#0F172A' }}>{f.visitor_first_name} {f.visitor_last_name}</span>
                      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: f.severity === 'blacklist' ? '#DC2626' : '#B45309' }}>
                        {f.severity}
                      </span>
                    </div>
                    {f.note && <div style={{ fontSize: 13, color: '#475569', marginTop: 4, lineHeight: 1.4 }}>{f.note}</div>}
                    <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>
                      Arrived {new Date(f.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Staff check-ins with a note or photo (guard needs to see who this is) */}
            {staffAlerts.length > 0 && (
              <div style={{ background: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <Bell size={18} color="#B45309" />
                  <span style={{ fontSize: 15, fontWeight: 800, color: '#0F172A' }}>Staff Alerts</span>
                </div>
                {staffAlerts.slice(0, 5).map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 12px', borderRadius: 10, marginBottom: 8, background: '#F8FAFC', alignItems: 'center' }}>
                    {s.photo ? (
                      <img src={s.photo} alt="" style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'linear-gradient(135deg, #0D7377, #14FFEC)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                        {s.first_name?.[0]}
                      </div>
                    )}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#0F172A' }}>{s.first_name} {s.last_name}</div>
                      {s.note && <div style={{ fontSize: 13, color: '#B45309', marginTop: 2, lineHeight: 1.4 }}>{s.note}</div>}
                      <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>
                        {new Date(s.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Overstaying visitors */}
            {overstaying.length > 0 && (
              <div style={{ background: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '2px solid #FDE68A' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <Timer size={18} color="#B45309" />
                  <span style={{ fontSize: 15, fontWeight: 800, color: '#92400E' }}>Overstaying (&gt;{overstayHours}h)</span>
                </div>
                {overstaying.slice(0, 5).map((v, i) => {
                  const hrs = Math.floor((Date.now() - new Date(v.checked_in_at).getTime()) / 3600000);
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10, marginBottom: 8, background: '#FFFBEB', border: '1px solid #FDE68A' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#0F172A' }}>{v.visitor_first_name} {v.visitor_last_name}</div>
                        <div style={{ fontSize: 12, color: '#94A3B8' }}>
                          In since {new Date(v.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 800, color: '#B45309', whiteSpace: 'nowrap' }}>{hrs}h on site</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Two Column Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
        {/* Recent Visits */}
        <div style={{
          background: '#fff', borderRadius: 20, padding: 24,
          boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A' }}>Recent Visits</h3>
            <button
              onClick={() => navigate('/visits')}
              style={{ color: '#0D7377', fontSize: 14, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }}
            >
              View All →
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(stats?.recent_visits || []).map((visit, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px',
                borderRadius: 12, background: '#F8FAFC'
              }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: 'linear-gradient(135deg, #0D7377, #14FFEC)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 14, color: '#fff'
                }}>
                  {visit.visitor_first_name?.[0]}{visit.visitor_last_name?.[0]}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: '#0F172A', fontSize: 14 }}>
                    {visit.visitor_first_name} {visit.visitor_last_name}
                  </div>
                  <div style={{ fontSize: 13, color: '#64748B' }}>
                    {visit.host_first_name ? `Visiting ${visit.host_first_name} ${visit.host_last_name}` : 'No host assigned'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{
                    fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 20,
                    background: visit.status === 'checked_in' ? '#DCFCE7' : '#F1F5F9',
                    color: visit.status === 'checked_in' ? '#166534' : '#64748B'
                  }}>
                    {visit.status === 'checked_in' ? 'On Site' : 'Checked Out'}
                  </div>
                  <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>
                    {new Date(visit.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div style={{
          background: '#fff', borderRadius: 20, padding: 24,
          boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0'
        }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 20 }}>Quick Actions</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { label: 'Add New Host', icon: Users, action: () => navigate('/hosts'), color: '#0D7377' },
              { label: 'View Evacuation List', icon: Bell, action: openEvacuation, color: '#FF6B35' },
              { label: 'Export Reports', icon: TrendingUp, action: () => setShowExport(true), color: '#9B59B6' },
              { label: 'Kiosk Settings', icon: Clock, action: () => navigate('/settings'), color: '#2ECC71' },
            ].map((action, i) => (
              <button
                key={i}
                onClick={action.action}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '16px', borderRadius: 12, border: '1px solid #E2E8F0',
                  background: '#fff', cursor: 'pointer', textAlign: 'left',
                  transition: 'all 0.2s', width: '100%'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#F8FAFC'; e.currentTarget.style.borderColor = action.color; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#E2E8F0'; }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: `${action.color}15`, display: 'flex',
                  alignItems: 'center', justifyContent: 'center'
                }}>
                  <action.icon size={18} color={action.color} />
                </div>
                <span style={{ fontWeight: 600, fontSize: 14, color: '#0F172A' }}>{action.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Export Options Modal */}
      {showExport && (
        <div className="responsive-modal"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20
        }}>
          <div style={{
            background: '#fff', borderRadius: 20, padding: 32, width: '100%', maxWidth: 480,
            boxShadow: '0 25px 80px rgba(0,0,0,0.3)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A' }}>Export Report</h2>
              <button onClick={() => setShowExport(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }}>
                <X size={22} />
              </button>
            </div>
            <p style={{ color: '#64748B', fontSize: 14, marginBottom: 20 }}>Choose what to export and the period it should cover.</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {EXPORT_TYPES.map(t => (
                <label key={t.key} style={{
                  display: 'flex', gap: 12, alignItems: 'flex-start', padding: '14px 16px',
                  borderRadius: 12, cursor: 'pointer',
                  border: exportType === t.key ? '2px solid #0D7377' : '1px solid #E2E8F0',
                  background: exportType === t.key ? '#F0FDFA' : '#fff'
                }}>
                  <input
                    type="radio" name="exportType" checked={exportType === t.key}
                    onChange={() => setExportType(t.key)} style={{ marginTop: 3 }}
                  />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#0F172A' }}>{t.label}</div>
                    <div style={{ fontSize: 13, color: '#64748B' }}>{t.desc}</div>
                  </div>
                </label>
              ))}
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 8 }}>Period</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {RANGES.map(r => (
                  <button
                    key={r.key}
                    onClick={() => setExportRange(r.key)}
                    style={{
                      padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      border: exportRange === r.key ? '2px solid #0D7377' : '1px solid #E2E8F0',
                      background: exportRange === r.key ? '#F0FDFA' : '#fff',
                      color: exportRange === r.key ? '#0D7377' : '#475569'
                    }}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={() => setShowExport(false)}
                style={{ flex: 1, padding: '13px', borderRadius: 10, background: '#F1F5F9', border: 'none', fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={runExport}
                disabled={exporting}
                style={{
                  flex: 1, padding: '13px', borderRadius: 10, background: '#0D7377', border: 'none',
                  color: '#fff', fontWeight: 600, cursor: exporting ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  opacity: exporting ? 0.7 : 1
                }}
              >
                <Download size={16} /> {exporting ? 'Exporting…' : 'Download CSV'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Evacuation List Modal */}
      {showEvac && (
        <div className="responsive-modal"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20
        }}>
          <div style={{
            background: '#fff', borderRadius: 20, padding: 32, width: '100%', maxWidth: 680,
            maxHeight: '85vh', overflow: 'auto', boxShadow: '0 25px 80px rgba(0,0,0,0.3)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A' }}>
                Evacuation List
              </h2>
              <span style={{ background: '#FF6B35', color: '#fff', padding: '6px 14px', borderRadius: 8, fontWeight: 700, fontSize: 14 }}>
                {evacList.length} on site
              </span>
            </div>

            {evacList.length === 0 ? (
              <p style={{ color: '#64748B', textAlign: 'center', padding: 32 }}>No one is currently checked in.</p>
            ) : (
              evacList.map(v => (
                <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: '#F8FAFC', borderRadius: 10, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15, color: '#0F172A' }}>{v.visitor_first_name} {v.visitor_last_name}</div>
                    <div style={{ fontSize: 12, color: '#64748B' }}>
                      {v.visitor_company || 'No company'}{v.host_first_name ? ` · with ${v.host_first_name} ${v.host_last_name}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 12, color: '#64748B' }}>
                    <div style={{ fontWeight: 600, color: '#0D7377' }}>{v.badge_number}</div>
                    <div>{v.checked_in_at ? new Date(v.checked_in_at).toLocaleTimeString() : ''}</div>
                  </div>
                </div>
              ))
            )}

            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
              <button onClick={() => setShowEvac(false)} style={{ flex: 1, padding: '13px', borderRadius: 10, background: '#F1F5F9', border: 'none', fontWeight: 600, cursor: 'pointer' }}>
                Close
              </button>
              <button onClick={printEvacuation} style={{ flex: 1, padding: '13px', borderRadius: 10, background: '#FF6B35', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                Print List
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
