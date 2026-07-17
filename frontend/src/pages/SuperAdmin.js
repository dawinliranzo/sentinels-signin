import React, { useState, useEffect } from 'react';
import { useStore } from '../utils/store';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import {
  Building2, Users, CreditCard, TrendingUp, DollarSign,
  Shield, Activity, ArrowUpRight, ArrowDownRight, Search,
  Filter, MoreHorizontal, Edit, Trash2, Eye
} from 'lucide-react';

export default function SuperAdmin() {
  const user = useStore((s) => s.user);
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState([]);
  const [stats, setStats] = useState({
    total_orgs: 0,
    total_users: 0,
    total_visits: 0,
    active_visits: 0,
    revenue: 0
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('all');

  // Redirect if not super_admin
  useEffect(() => {
    if (user?.role !== 'super_admin') {
      navigate('/');
    }
  }, [user, navigate]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      // For MVP, we'll simulate the data
      // In production, these would be real API calls
      const orgsData = [
        {
          id: '11f39a06-908a-4f74-85dd-e846a006651b',
          name: 'Sentinels',
          slug: 'sentinels',
          plan: 'pro',
          status: 'active',
          created_at: '2026-07-10',
          users_count: 3,
          visits_this_month: 142,
          billing_email: 'admin@sentinels.com',
          mrr: 49
        },
        {
          id: '00000000-0000-0000-0000-000000000001',
          name: 'Demo Organization',
          slug: 'demo-org',
          plan: 'free',
          status: 'active',
          created_at: '2026-07-15',
          users_count: 1,
          visits_this_month: 12,
          billing_email: 'demo@example.com',
          mrr: 0
        }
      ];

      setOrgs(orgsData);
      setStats({
        total_orgs: orgsData.length,
        total_users: orgsData.reduce((a, o) => a + o.users_count, 0),
        total_visits: orgsData.reduce((a, o) => a + o.visits_this_month, 0),
        active_visits: 2,
        revenue: orgsData.reduce((a, o) => a + o.mrr, 0)
      });
    } catch (err) {
      console.error('Failed to fetch super admin data:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredOrgs = orgs.filter(o => {
    const matchesSearch = o.name.toLowerCase().includes(search.toLowerCase()) ||
                         o.billing_email.toLowerCase().includes(search.toLowerCase());
    const matchesPlan = planFilter === 'all' || o.plan === planFilter;
    return matchesSearch && matchesPlan;
  });

  const planColors = {
    free: '#94A3B8',
    pro: '#0D7377',
    enterprise: '#FF6B35'
  };

  const planLabels = {
    free: 'Free',
    pro: 'Pro ($49/mo)',
    enterprise: 'Enterprise ($149/mo)'
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading...</div>;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 800, color: '#0F172A', marginBottom: 4 }}>
            Super Admin
          </h1>
          <p style={{ color: '#64748B', fontSize: 15 }}>
            Manage all organizations and subscriptions
          </p>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 16px', borderRadius: 10,
          background: '#FEF3C7', color: '#92400E', fontSize: 14, fontWeight: 600
        }}>
          <Shield size={16} />
          Super Admin Access
        </div>
      </div>

      {/* Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 20, marginBottom: 32 }}>
        {[
          { title: 'Organizations', value: stats.total_orgs, icon: Building2, color: '#0D7377', trend: '+2' },
          { title: 'Total Users', value: stats.total_users, icon: Users, color: '#FF6B35', trend: '+5' },
          { title: 'Monthly Visits', value: stats.total_visits, icon: Activity, color: '#9B59B6', trend: '+23%' },
          { title: 'Active Now', value: stats.active_visits, icon: TrendingUp, color: '#2ECC71', trend: '0' },
          { title: 'MRR', value: `$${stats.revenue}`, icon: DollarSign, color: '#0D7377', trend: '+$49' },
        ].map((card, i) => (
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
            <div style={{ fontSize: 32, fontWeight: 800, color: '#0F172A', marginBottom: 4 }}>
              {card.value}
            </div>
            <div style={{ fontSize: 14, color: '#64748B' }}>{card.title}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex', gap: 12, marginBottom: 24,
        background: '#fff', padding: '16px 20px', borderRadius: 16,
        boxShadow: '0 2px 10px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0'
      }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
          <input
            type="text" placeholder="Search organizations..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '12px 16px 12px 44px', borderRadius: 10,
              border: '2px solid #E2E8F0', fontSize: 14, outline: 'none'
            }}
          />
        </div>
        <select
          value={planFilter} onChange={(e) => setPlanFilter(e.target.value)}
          style={{ padding: '12px 16px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14, background: '#fff' }}
        >
          <option value="all">All Plans</option>
          <option value="free">Free</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
        </select>
      </div>

      {/* Organizations Table */}
      <div style={{
        background: '#fff', borderRadius: 20, overflow: 'hidden',
        boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#F8FAFC' }}>
              {['Organization', 'Plan', 'Users', 'Visits', 'MRR', 'Status', 'Actions'].map(h => (
                <th key={h} style={{ padding: '16px 20px', textAlign: 'left', fontSize: 13, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredOrgs.map(org => (
              <tr key={org.id} style={{ borderTop: '1px solid #E2E8F0' }}>
                <td style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: '50%',
                      background: 'linear-gradient(135deg, #0D7377, #14FFEC)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 14, color: '#fff'
                    }}>
                      {org.name[0]}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, color: '#0F172A', fontSize: 14 }}>{org.name}</div>
                      <div style={{ fontSize: 12, color: '#64748B' }}>{org.billing_email}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '16px 20px' }}>
                  <span style={{
                    fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 20,
                    background: `${planColors[org.plan]}15`, color: planColors[org.plan]
                  }}>
                    {planLabels[org.plan]}
                  </span>
                </td>
                <td style={{ padding: '16px 20px', fontSize: 14, color: '#334155' }}>{org.users_count}</td>
                <td style={{ padding: '16px 20px', fontSize: 14, color: '#334155' }}>{org.visits_this_month}</td>
                <td style={{ padding: '16px 20px', fontSize: 14, fontWeight: 600, color: '#0F172A' }}>
                  ${org.mrr}/mo
                </td>
                <td style={{ padding: '16px 20px' }}>
                  <span style={{
                    fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 20,
                    background: org.status === 'active' ? '#DCFCE7' : '#FEF2F2',
                    color: org.status === 'active' ? '#166534' : '#991B1B'
                  }}>
                    {org.status}
                  </span>
                </td>
                <td style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button style={{ padding: 8, borderRadius: 8, background: '#F1F5F9', border: 'none', cursor: 'pointer' }}>
                      <Eye size={16} color="#64748B" />
                    </button>
                    <button style={{ padding: 8, borderRadius: 8, background: '#F1F5F9', border: 'none', cursor: 'pointer' }}>
                      <Edit size={16} color="#64748B" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Kiosk URL Generator */}
      <div style={{
        background: '#fff', borderRadius: 20, padding: 24,
        marginTop: 24, boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0'
      }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 16 }}>
          Kiosk URL Generator
        </h3>
        <p style={{ color: '#64748B', fontSize: 14, marginBottom: 16 }}>
          Share this URL with each organization for their kiosk:
        </p>
        {filteredOrgs.map(org => (
          <div key={org.id} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', background: '#F8FAFC', borderRadius: 10, marginBottom: 8
          }}>
            <div>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{org.name}</span>
              <span style={{ color: '#64748B', fontSize: 12, marginLeft: 8 }}>{org.plan}</span>
            </div>
            <code style={{
              fontSize: 12, background: '#E2E8F0', padding: '4px 8px', borderRadius: 6,
              fontFamily: 'monospace'
            }}>
              {`${window.location.origin}/kiosk?org=${org.id}`}
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}
