import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { Monitor, Plus, Copy, Pencil, Trash2, Check, ExternalLink, Wifi, WifiOff } from 'lucide-react';
import api from '../utils/api';
import { toast } from '../utils/toast';
import { useStore } from '../utils/store';

export default function Devices() {
  const org = useStore((s) => s.organization);
  const user = useStore((s) => s.user);
  const canManage = user?.role === 'admin' || user?.role === 'super_admin';

  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [freshDevice, setFreshDevice] = useState(null); // just-created -> show code big
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [addError, setAddError] = useState('');

  const { data: devices, refetch } = useQuery('devices', () =>
    api.get('/devices').then(r => r.data),
    { refetchInterval: 15000 } // keep online status fresh
  );

  const addDevice = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setAdding(true);
    setAddError('');
    try {
      const res = await api.post('/devices', { name: newName.trim() });
      setFreshDevice(res.data);
      setNewName('');
      refetch();
      toast(`Kiosk "${res.data.name}" registered`);
    } catch (err) {
      const msg = err.response?.data?.error
        || (err.response?.status === 404 ? 'Devices route not found on the server — deploy the backend files first' : 'Failed to add device');
      setAddError(msg);
      toast(msg, 'error');
    } finally {
      setAdding(false);
    }
  };

  const saveRename = async (id) => {
    if (!renameValue.trim()) { setRenamingId(null); return; }
    try {
      await api.patch(`/devices/${id}`, { name: renameValue.trim() });
      setRenamingId(null);
      refetch();
      toast('Device renamed');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to rename', 'error');
    }
  };

  const removeDevice = async (id) => {
    try {
      await api.delete(`/devices/${id}`);
      setConfirmDeleteId(null);
      refetch();
      toast('Device removed — its kiosk will need a new pairing code');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to remove device', 'error');
    }
  };

  const copyCode = (d) => {
    navigator.clipboard.writeText(d.pair_code);
    setCopiedId(d.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const lastSeen = (d) => {
    if (!d.last_seen_at) return 'never seen';
    const mins = Math.floor((Date.now() - new Date(d.last_seen_at).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const kioskUrl = `${window.location.origin}/kiosk${org?.id ? `?org=${org.id}` : ''}`;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0F172A' }}>Kiosk Devices</h1>
          <p style={{ color: '#64748B', marginTop: 4 }}>Register your kiosk tablets and see if they're online</p>
        </div>
        <a href={kioskUrl} target="_blank" rel="noopener noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 24px', borderRadius: 12, background: '#F1F5F9', border: 'none', color: '#0F172A', fontWeight: 600, cursor: 'pointer', fontSize: 14, textDecoration: 'none' }}>
          <ExternalLink size={16} /> Open Kiosk
        </a>
      </div>

      {/* Add device */}
      {canManage && (
        <form onSubmit={addDevice} style={{
          background: '#fff', borderRadius: 16, padding: 20, marginBottom: 20,
          boxShadow: '0 2px 10px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0',
          display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap'
        }}>
          <Monitor size={20} color="#0D7377" />
          <input
            type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder="Name this kiosk — e.g. Front Desk, Warehouse iPad"
            style={{ flex: 1, minWidth: 240, padding: '12px 16px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 14, outline: 'none' }}
          />
          <button type="submit" disabled={adding || !newName.trim()}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderRadius: 10, background: adding ? '#94A3B8' : '#0D7377', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
            <Plus size={16} /> {adding ? 'Adding…' : 'Add Kiosk'}
          </button>
          {addError && (
            <div style={{
              width: '100%', padding: '12px 16px', borderRadius: 10,
              background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C',
              fontSize: 13, fontWeight: 500
            }}>
              {addError}
            </div>
          )}
        </form>
      )}

      {/* Pairing code spotlight for a freshly added device */}
      {freshDevice && (
        <div style={{
          background: 'linear-gradient(135deg, #0F172A, #123B4F)', borderRadius: 16, padding: 28,
          marginBottom: 20, color: '#fff', textAlign: 'center'
        }}>
          <div style={{ fontSize: 15, opacity: 0.85, marginBottom: 6 }}>Pairing code for <strong>{freshDevice.name}</strong></div>
          <div style={{
            fontSize: 40, fontWeight: 800, letterSpacing: 10, fontFamily: 'monospace',
            color: '#14FFEC', margin: '12px 0'
          }}>
            {freshDevice.pair_code}
          </div>
          <div style={{ fontSize: 13, opacity: 0.7, maxWidth: 480, margin: '0 auto 16px' }}>
            On the kiosk screen, tap <strong>"Pair this kiosk"</strong> at the bottom and enter this code.
            The device will appear as online within a minute.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button onClick={() => copyCode(freshDevice)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 10, background: 'rgba(20,255,236,0.15)', border: '1px solid rgba(20,255,236,0.4)', color: '#14FFEC', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
              {copiedId === freshDevice.id ? <Check size={15} /> : <Copy size={15} />} {copiedId === freshDevice.id ? 'Copied' : 'Copy code'}
            </button>
            <button onClick={() => setFreshDevice(null)}
              style={{ padding: '10px 20px', borderRadius: 10, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
              Done
            </button>
          </div>
        </div>
      )}

      {/* Device list */}
      <div style={{ background: '#fff', borderRadius: 20, overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0' }}>
        {(!devices || devices.length === 0) ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#64748B' }}>
            <Monitor size={40} color="#CBD5E1" style={{ margin: '0 auto 12px' }} />
            <div style={{ fontWeight: 600, color: '#334155', marginBottom: 4 }}>No kiosks registered yet</div>
            <div style={{ fontSize: 14 }}>Add your first kiosk above, then enter its pairing code on the tablet.</div>
          </div>
        ) : devices.map((d, i) => (
          <div key={d.id} style={{
            display: 'flex', alignItems: 'center', gap: 16, padding: '18px 24px',
            borderTop: i === 0 ? 'none' : '1px solid #F1F5F9', flexWrap: 'wrap'
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12, flexShrink: 0,
              background: d.is_online ? 'rgba(13,115,119,0.1)' : '#F1F5F9',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              {d.is_online ? <Wifi size={20} color="#0D7377" /> : <WifiOff size={20} color="#94A3B8" />}
            </div>

            <div style={{ flex: 1, minWidth: 180 }}>
              {renamingId === d.id ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input autoFocus type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveRename(d.id); if (e.key === 'Escape') setRenamingId(null); }}
                    style={{ padding: '8px 12px', borderRadius: 8, border: '2px solid #0D7377', fontSize: 14, outline: 'none' }} />
                  <button onClick={() => saveRename(d.id)} style={{ padding: '8px 14px', borderRadius: 8, background: '#0D7377', border: 'none', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Save</button>
                  <button onClick={() => setRenamingId(null)} style={{ padding: '8px 14px', borderRadius: 8, background: '#F1F5F9', border: 'none', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                </div>
              ) : (
                <>
                  <div style={{ fontWeight: 700, color: '#0F172A', fontSize: 15 }}>{d.name}</div>
                  <div style={{ fontSize: 12, color: '#64748B' }}>
                    {d.paired_at ? 'Paired' : 'Not paired yet'} · last seen {lastSeen(d)}
                  </div>
                </>
              )}
            </div>

            <span style={{
              fontSize: 12, fontWeight: 700, padding: '5px 14px', borderRadius: 20,
              background: d.is_online ? '#DCFCE7' : '#F1F5F9',
              color: d.is_online ? '#166534' : '#64748B'
            }}>
              {d.is_online ? '● ONLINE' : '○ OFFLINE'}
            </span>

            <button onClick={() => copyCode(d)} title="Copy pairing code"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 8, background: '#F8FAFC', border: '1px solid #E2E8F0', fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: '#334155', cursor: 'pointer', letterSpacing: 2 }}>
              {copiedId === d.id ? <Check size={14} color="#166534" /> : <Copy size={14} />} {d.pair_code}
            </button>

            {canManage && renamingId !== d.id && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => { setRenamingId(d.id); setRenameValue(d.name); }} title="Rename"
                  style={{ padding: 8, borderRadius: 8, background: '#F1F5F9', border: 'none', cursor: 'pointer' }}>
                  <Pencil size={15} color="#64748B" />
                </button>
                {confirmDeleteId === d.id ? (
                  <>
                    <button onClick={() => removeDevice(d.id)} style={{ padding: '8px 10px', borderRadius: 8, background: '#EF4444', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Confirm</button>
                    <button onClick={() => setConfirmDeleteId(null)} style={{ padding: '8px 10px', borderRadius: 8, background: '#F1F5F9', border: 'none', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                  </>
                ) : (
                  <button onClick={() => setConfirmDeleteId(d.id)} title="Remove device"
                    style={{ padding: 8, borderRadius: 8, background: '#FEF2F2', border: 'none', cursor: 'pointer' }}>
                    <Trash2 size={15} color="#EF4444" />
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <p style={{ fontSize: 13, color: '#94A3B8', marginTop: 16, textAlign: 'center' }}>
        A kiosk counts as online while its screen is open and heartbeating (checked every 15s here). Offline kiosks also trigger your email alerts if enabled in Settings.
      </p>
    </div>
  );
}
