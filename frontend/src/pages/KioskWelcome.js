import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, LogIn, LogOut } from 'lucide-react';

export default function KioskWelcome() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Get org ID from URL param — REQUIRED, no fallback
  const orgId = searchParams.get('org');

  // Store org ID for subsequent pages
  React.useEffect(() => {
    if (orgId) {
      localStorage.setItem('kiosk_org_id', orgId);
    }
  }, [orgId]);

  // GUARD: No org ID = show error screen
  if (!orgId) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', zIndex: 1, maxWidth: 600,
        padding: 40
      }}>
        <div style={{
          width: 80, height: 80, borderRadius: 20,
          background: 'rgba(255,107,53,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 24
        }}>
          <span style={{ fontSize: 40 }}>⚠️</span>
        </div>
        <h1 style={{
          fontSize: 32, fontWeight: 700, color: '#fff',
          marginBottom: 12
        }}>
          Kiosk Not Configured
        </h1>
        <p style={{
          fontSize: 18, color: 'rgba(255,255,255,0.7)',
          marginBottom: 32, lineHeight: 1.5
        }}>
          This kiosk needs an organization ID to work.<br />
          Please use the URL provided by your administrator.
        </p>
        <div style={{
          background: 'rgba(255,255,255,0.1)', borderRadius: 16,
          padding: '20px 24px', border: '1px solid rgba(255,255,255,0.2)',
          maxWidth: 400
        }}>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
            Example URL format:
          </p>
          <code style={{
            fontSize: 12, color: '#14FFEC', fontFamily: 'monospace',
            wordBreak: 'break-all'
          }}>
            https://yoursite.com/kiosk?org=your-org-id
          </code>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      textAlign: 'center', zIndex: 1, maxWidth: 600
    }}>
      {/* Logo */}
      <div style={{
        width: 120, height: 120, borderRadius: 30,
        background: 'linear-gradient(135deg, #0D7377, #14FFEC)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 40, boxShadow: '0 20px 60px rgba(13, 115, 119, 0.4)',
        fontSize: 60, fontWeight: 800, color: '#fff'
      }}>
        S
      </div>

      <h1 style={{
        fontSize: 52, fontWeight: 800, color: '#fff',
        marginBottom: 8, letterSpacing: '-0.02em'
      }}>
        Welcome
      </h1>
      <p style={{
        fontSize: 20, color: 'rgba(255,255,255,0.7)',
        marginBottom: 60
      }}>
        Please select an option to continue
      </p>

      {/* Action Buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: 400 }}>
        <button
          onClick={() => navigate(`/kiosk/sign-in?org=${orgId}`)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
            padding: '28px 40px', borderRadius: 20,
            background: 'linear-gradient(135deg, #FF6B35, #FF8C5A)',
            border: 'none', color: '#fff', cursor: 'pointer',
            fontSize: 24, fontWeight: 700,
            boxShadow: '0 12px 40px rgba(255, 107, 53, 0.4)',
            transition: 'transform 0.2s, box-shadow 0.2s'
          }}
          onMouseEnter={(e) => {
            e.target.style.transform = 'translateY(-2px)';
            e.target.style.boxShadow = '0 16px 50px rgba(255, 107, 53, 0.5)';
          }}
          onMouseLeave={(e) => {
            e.target.style.transform = 'translateY(0)';
            e.target.style.boxShadow = '0 12px 40px rgba(255, 107, 53, 0.4)';
          }}
        >
          <LogIn size={32} />
          Sign In
          <ArrowRight size={28} />
        </button>

        <button
          onClick={() => navigate(`/kiosk/sign-out?org=${orgId}`)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
            padding: '28px 40px', borderRadius: 20,
            background: 'rgba(255,255,255,0.1)',
            border: '2px solid rgba(255,255,255,0.3)',
            color: '#fff', cursor: 'pointer',
            fontSize: 24, fontWeight: 600,
            backdropFilter: 'blur(10px)',
            transition: 'all 0.2s'
          }}
          onMouseEnter={(e) => {
            e.target.style.background = 'rgba(255,255,255,0.2)';
            e.target.style.borderColor = 'rgba(255,255,255,0.5)';
          }}
          onMouseLeave={(e) => {
            e.target.style.background = 'rgba(255,255,255,0.1)';
            e.target.style.borderColor = 'rgba(255,255,255,0.3)';
          }}
        >
          <LogOut size={32} />
          Sign Out
        </button>
      </div>

      <p style={{
        marginTop: 40, fontSize: 14, color: 'rgba(255,255,255,0.4)'
      }}>
        Powered by Sentinels Sign-In
      </p>
    </div>
  );
}
