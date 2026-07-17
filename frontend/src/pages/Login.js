import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../utils/store';
import api from '../utils/api';

export default function Login() {
  const navigate = useNavigate();
  const setAuth = useStore((s) => s.setAuth);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { email, password });
      setAuth(res.data.token, res.data.user, res.data.organization);
      navigate('/');
    } catch (err) {
      alert('Invalid credentials');
    } finally {
      setLoading(false);
    }
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
            Sentinels Sign-In
          </h1>
          <p style={{ color: '#64748B', fontSize: 15 }}>Sign in to your admin dashboard</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 8 }}>
              Email Address
            </label>
            <input
              type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                width: '100%', padding: '14px 16px', borderRadius: 12,
                border: '2px solid #E2E8F0', fontSize: 15, outline: 'none',
                transition: 'border-color 0.2s'
              }}
              onFocus={(e) => e.target.style.borderColor = '#0D7377'}
              onBlur={(e) => e.target.style.borderColor = '#E2E8F0'}
              placeholder="admin@company.com"
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#334155', marginBottom: 8 }}>
              Password
            </label>
            <input
              type="password" required value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: '100%', padding: '14px 16px', borderRadius: 12,
                border: '2px solid #E2E8F0', fontSize: 15, outline: 'none'
              }}
              onFocus={(e) => e.target.style.borderColor = '#0D7377'}
              onBlur={(e) => e.target.style.borderColor = '#E2E8F0'}
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '16px', borderRadius: 12,
              background: loading ? '#94A3B8' : '#0D7377', border: 'none',
              color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer',
              marginTop: 8, transition: 'background 0.2s'
            }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 24, fontSize: 14, color: '#64748B' }}>
          Don't have an account?{' '}
          <a href="/register" style={{ color: '#0D7377', fontWeight: 600, textDecoration: 'none' }}>
            Create one
          </a>
        </p>
      </div>
    </div>
  );
}
