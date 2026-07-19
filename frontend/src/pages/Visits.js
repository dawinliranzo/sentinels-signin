import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { Search, Filter, Download, CheckCircle, XCircle } from 'lucide-react';
import api from '../utils/api';
import { toast } from '../utils/toast';

export default function Visits() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('');

  const { data: visits, isLoading, refetch } = useQuery(
    ['visits', statusFilter, dateFilter, search],
    () => api.get(`/visits?status=${statusFilter !== 'all' ? statusFilter : ''}&date=${dateFilter}&search=${search}`).then(r => r.data),
    { keepPreviousData: true }
  );

  const handleCheckOut = async (id) => {
    if (!window.confirm('Check out this visitor?')) return;
    try {
      await api.post(`/visits/${id}/check-out`);
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
        display: 'flex', gap: 12, marginBottom: 24,
        background: '#fff', padding: '16px 20px', borderRadius: 16,
        boxShadow: '0 2px 10px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0'
      }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
          <input
            type="text" placeholder="Search visitors..."
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
        <input
          type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}
          style={{ padding: '12px 16px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14 }}
        />
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
                  {v.status === 'checked_in' && (
                    <button
                      onClick={() => handleCheckOut(v.id)}
                      style={{
                        padding: '8px 16px', borderRadius: 8,
                        background: '#FF6B35', border: 'none', color: '#fff',
                        fontSize: 12, fontWeight: 600, cursor: 'pointer'
                      }}
                    >
                      Check Out
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
