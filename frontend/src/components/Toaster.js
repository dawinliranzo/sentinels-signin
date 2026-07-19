import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Info } from 'lucide-react';

let nextId = 1;

export default function Toaster() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const handler = (e) => {
      const id = nextId++;
      const { message, type } = e.detail;
      setToasts(t => [...t, { id, message, type }]);
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
    };
    window.addEventListener('app-toast', handler);
    return () => window.removeEventListener('app-toast', handler);
  }, []);

  const styles = {
    success: { bg: '#0F766E', Icon: CheckCircle },
    error:   { bg: '#DC2626', Icon: XCircle },
    info:    { bg: '#334155', Icon: Info },
  };

  return (
    <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {toasts.map(t => {
        const { bg, Icon } = styles[t.type] || styles.info;
        return (
          <div key={t.id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: bg, color: '#fff', padding: '14px 20px', borderRadius: 12,
            boxShadow: '0 10px 30px rgba(0,0,0,0.25)', fontSize: 14, fontWeight: 600,
            maxWidth: 360, animation: 'toast-in 0.2s ease-out'
          }}>
            <Icon size={18} style={{ flexShrink: 0 }} />
            <span>{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}
