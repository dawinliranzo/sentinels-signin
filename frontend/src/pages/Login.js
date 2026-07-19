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
  const [error, setError] = useState(null);

  // MFA second step
  const [mfaToken, setMfaToken] = useState(null);
  const [mfaCode, setMfaCode] = useState('');

  // Forced password change (first login / after admin reset)
  const [changeToken, setChangeToken] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.post('/auth/login', { email, password });
      if (res.data.must_change_password) {
        setChangeToken(res.data.change_token);
      } else if (res.data.mfa_required) {
        setMfaToken(res.data.mfa_token);
      } else {
        setAuth(res.data.token, res.data.user, res.data.organization);
        navigate(res.data.mfa_setup_required ? '/settings' : '/');
      }
    } catch (err) {
      setError('Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.post('/auth/mfa/login', { mfa_token: mfaToken, code: mfaCode });
      setAuth(res.data.token, res.data.user, res.data.organization);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/auth/set-password', { token: changeToken, password: newPassword });
      setAuth(res.data.token, res.data.user, res.data.organization);
      navigate(res.data.mfa_setup_required ? '/settings' : '/');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to set password');
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
          <p style={{ color: '#64748B', fontSize: 15 }}>
            {changeToken ? 'Set your new password to continue' : mfaToken ? 'Enter your authentication code' : 'Sign in to your admin dashboard'}
          </p>
        </div>

        {changeToken ? (
          <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 12, padding: '12px 16px', fontSize: 13, color: '#92400E' }}>
              You're signing in with a temporary password. Choose a new one to continue.
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 8 }}>New password (min 8 characters)</label>
              <input
                type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required autoFocus
                style={{ width: '100%', padding: '14px 16px', borderRadius: 12, border: '2px solid #E2E8F0', fontSize: 15, outline: 'none' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 8 }}>Confirm new password</label>
              <input
                type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required
                style={{ width: '100%', padding: '14px 16px', borderRadius: 12, border: '2px solid #E2E8F0', fontSize: 15, outline: 'none' }}
              />
            </div>
            {error && <p style={{ color: '#DC2626', fontSize: 14, margin: 0, textAlign: 'center' }}>{error}</p>}
            <button
              type="submit" disabled={loading}
              style={{
                padding: '16px', borderRadius: 12, border: 'none',
                background: loading ? '#94A3B8' : 'linear-gradient(135deg, #0D7377, #14919B)',
                color: '#fff', fontSize: 16, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer'
              }}
            >
              {loading ? 'Saving...' : 'Set Password & Sign In'}
            </button>
          </form>
        ) : !mfaToken ? (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 8 }}>Email</label>
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                style={{ width: '100%', padding: '14px 16px', borderRadius: 12, border: '2px solid #E2E8F0', fontSize: 15, outline: 'none' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 8 }}>Password</label>
              <input
                type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                style={{ width: '100%', padding: '14px 16px', borderRadius: 12, border: '2px solid #E2E8F0', fontSize: 15, outline: 'none' }}
              />
            </div>
            {error && <p style={{ color: '#DC2626', fontSize: 14, margin: 0, textAlign: 'center' }}>{error}</p>}
            <button
              type="submit" disabled={loading}
              style={{
                padding: '16px', borderRadius: 12, border: 'none',
                background: loading ? '#94A3B8' : 'linear-gradient(135deg, #0D7377, #14919B)',
                color: '#fff', fontSize: 16, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer'
              }}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleMfaSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 8 }}>
                6-digit code from your authenticator app
              </label>
              <input
                type="text" inputMode="numeric" autoComplete="one-time-code"
                value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} required autoFocus
                placeholder="123456"
                style={{ width: '100%', padding: '14px 16px', borderRadius: 12, border: '2px solid #E2E8F0', fontSize: 22, letterSpacing: 8, textAlign: 'center', outline: 'none' }}
              />
            </div>
            {error && <p style={{ color: '#DC2626', fontSize: 14, margin: 0, textAlign: 'center' }}>{error}</p>}
            <button
              type="submit" disabled={loading}
              style={{
                padding: '16px', borderRadius: 12, border: 'none',
                background: loading ? '#94A3B8' : 'linear-gradient(135deg, #0D7377, #14919B)',
                color: '#fff', fontSize: 16, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer'
              }}
            >
              {loading ? 'Verifying...' : 'Verify'}
            </button>
            <button
              type="button" onClick={() => { setMfaToken(null); setMfaCode(''); setError(null); }}
              style={{ background: 'none', border: 'none', color: '#64748B', fontSize: 14, cursor: 'pointer' }}
            >
              Back to login
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
