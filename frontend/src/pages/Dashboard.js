import React from 'react';
import { useQuery } from 'react-query';
import { useNavigate } from 'react-router-dom';
import {
  Users, LogIn, Clock, Building2, TrendingUp,
  ArrowUpRight, ArrowDownRight, Bell, Calendar
} from 'lucide-react';
import api from '../utils/api';
import { useStore } from '../utils/store';

export default function Dashboard() {
  const navigate = useNavigate();
  const org = useStore((s) => s.organization);
  const { data: stats, isLoading } = useQuery('dashboard-stats', () =>
    api.get('/dashboard/stats').then(r => r.data)
  );

  const statCards = [
    { title: 'Active Visitors', value: stats?.active_visitors || 0, icon: Users, color: '#0D7377', trend: '+12%' },
    { title: "Today's Visits", value: stats?.today_visits || 0, icon: LogIn, color: '#FF6B35', trend: '+8%' },
    { title: 'Weekly Visits', value: stats?.weekly_visits || 0, icon: Calendar, color: '#9B59B6', trend: '+23%' },
    { title: 'Active Hosts', value: stats?.active_hosts || 0, icon: Building2, color: '#2ECC71', trend: '0%' },
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
              <span style={{
                display: 'flex', alignItems: 'center', gap: 4,
                fontSize: 13, fontWeight: 600, color: card.trend.startsWith('+') ? '#2ECC71' : '#64748B'
              }}>
                {card.trend.startsWith('+') ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                {card.trend}
              </span>
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
              { label: 'View Evacuation List', icon: Bell, action: () => {}, color: '#FF6B35' },
              { label: 'Export Reports', icon: TrendingUp, action: () => {}, color: '#9B59B6' },
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
    </div>
  );
}
