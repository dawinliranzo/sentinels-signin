import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../utils/store';
import api from '../utils/api';

export default function Register() {
  const navigate = useNavigate();
  const setAuth = useStore((s) => s.setAuth);
  const [form, setForm] = useState({ org_name: '', first_name: '', last_name: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post('/auth/register', form);
      setAuth(res.data.token, res.data.user, res.data.organization);
      navigate('/');
    } catch (err) {
      alert('Registration failed: ' + (err.response?.data?.error || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: '100%', padding: '14px 16px', borderRadius: 12,
    border: '2px solid #E2E8F0', fontSize: 15, outline: 'none'
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #0D7377 0%, #0F172A 100%)', padding: 24
    }}>
      <div style={{
        width: '100%', maxWidth: 440, background: '#fff', borderRadius: 24,
        padding: '48px 40px', boxShadow: '0 25px 80px rgba(0,0,0,0.3)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            width: 64, height: 64, borderRadius: 16,
            background: 'linear-gradient(135deg, #0D7377, #14FFEC)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px', fontSize: 28, fontWeight: 800, color: '#fff'
          }}>
            S
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}>
            Get Started
          </h1>
          <p style={{ color: '#64748B', fontSize: 15 }}>Create your organization account</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <input type="text" placeholder="Organization Name" required
            value={form.org_name} onChange={(e) => setForm({...form, org_name: e.target.value})}
            style={inputStyle} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <input type="text" placeholder="First Name" required
              value={form.first_name} onChange={(e) => setForm({...form, first_name: e.target.value})}
              style={inputStyle} />
            <input type="text" placeholder="Last Name" required
              value={form.last_name} onChange={(e) => setForm({...form, last_name: e.target.value})}
              style={inputStyle} />
          </div>
          <input type="email" placeholder="Email Address" required
            value={form.email} onChange={(e) => setForm({...form, email: e.target.value})}
            style={inputStyle} />
          <input type="password" placeholder="Password" required minLength={8}
            value={form.password} onChange={(e) => setForm({...form, password: e.target.value})}
            style={inputStyle} />

          <button type="submit" disabled={loading}
            style={{
              width: '100%', padding: '16px', borderRadius: 12,
              background: loading ? '#94A3B8' : '#0D7377', border: 'none',
              color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer', marginTop: 8
            }}>
            {loading ? 'Creating...' : 'Create Account'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 24, fontSize: 14, color: '#64748B' }}>
          Already have an account?{' '}
          <a href="/login" style={{ color: '#0D7377', fontWeight: 600, textDecoration: 'none' }}>
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
