import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { useNavigate } from 'react-router-dom';
import {
  Users, LogIn, Clock, Building2, TrendingUp,
  ArrowUpRight, ArrowDownRight, Bell, Calendar
} from 'lucide-react';
import api from '../utils/api';
import { toast } from '../utils/toast';
import { useStore } from '../utils/store';

export default function Dashboard() {
  const navigate = useNavigate();
  const org = useStore((s) => s.organization);
  const [showEvac, setShowEvac] = useState(false);
  const [evacList, setEvacList] = useState([]);
  const [exporting, setExporting] = useState(false);

  const openEvacuation = async () => {
    try {
      const res = await api.get('/visits/active');
      setEvacList(res.data);
      setShowEvac(true);
    } catch (err) {
      toast('Failed to load evacuation list', 'error');
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await api.get('/visits');
      const rows = res.data;
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const header = ['First Name','Last Name','Email','Phone','Company','Purpose','Badge','Method','Status','Checked In','Checked Out'];
      const lines = [header.join(',')];
      rows.forEach(v => lines.push([
        v.visitor_first_name, v.visitor_last_name, v.visitor_email, v.visitor_phone, v.visitor_company,
        v.purpose, v.badge_number, v.sign_in_method, v.status,
        v.checked_in_at ? new Date(v.checked_in_at).toLocaleString() : '',
        v.checked_out_at ? new Date(v.checked_out_at).toLocaleString() : ''
      ].map(esc).join(',')));
      const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `visits-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      toast('Failed to export visits', 'error');
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

  const statCards = [
    { title: 'Active Visitors', value: stats?.active_visitors || 0, icon: Users, color: '#0D7377' },
    { title: "Today's Visits", value: stats?.today_visits || 0, icon: LogIn, color: '#FF6B35' },
    { title: 'Weekly Visits', value: stats?.weekly_visits || 0, icon: Calendar, color: '#9B59B6' },
    { title: 'Active Hosts', value: stats?.active_hosts || 0, icon: Building2, color: '#2ECC71' },
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

      {/* Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20, marginBottom: 32 }}>
        {statCards.map((card, i) => (
          <div key={i} style={{
            background: '#fff', borderRadius: 20, padding: 24,
            boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 14,
                background: `${card.color}15`, display: 'flex',
                alignItems: 'center', justifyContent: 'center'
              }}>
                <card.icon size={24} color={card.color} />
              </div>
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, color: '#0F172A', marginBottom: 4 }}>
              {isLoading ? '...' : card.value}
            </div>
            <div style={{ fontSize: 14, color: '#64748B' }}>{card.title}</div>
          </div>
        ))}
      </div>

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
              { label: exporting ? 'Exporting…' : 'Export Reports', icon: TrendingUp, action: exportCsv, color: '#9B59B6' },
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
                onMouseEnter={(e) => { e.target.style.background = '#F8FAFC'; e.target.style.borderColor = action.color; }}
                onMouseLeave={(e) => { e.target.style.background = '#fff'; e.target.style.borderColor = '#E2E8F0'; }}
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

      {/* Evacuation List Modal */}
      {showEvac && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
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
