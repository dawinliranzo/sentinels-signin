import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { Monitor, Plus, Copy, Pencil, Trash2, Check, ExternalLink, Wifi, WifiOff, QrCode , Printer, RotateCcw } from 'lucide-react';
import { printBadge } from '../utils/badge';
import { QRCodeCanvas } from 'qrcode.react';
import api from '../utils/api';
import { toast } from '../utils/toast';
import { useStore } from '../utils/store';

// Print a sample badge from this very browser — proves the kiosk computer can
// reach a printer before you rely on auto-print during real check-ins
const testPrint = (d) => {
  const ok = printBadge({
    title: 'VISITOR',
    firstName: 'Test', lastName: 'Visitor',
    company: 'Sentinels Print Check',
    hostName: d.name, hostLabel: 'Kiosk',
    badgeNo: 'TEST-001',
  });
  if (!ok) toast('This browser blocked the print — check its print permissions', 'error');
};


export default function Devices() {
  const org = useStore((s) => s.organization);
  const user = useStore((s) => s.user);
  const canManage = user?.role === 'admin' || user?.role === 'super_admin' || user?.switched || (user?.permissions || []).includes('devices');

  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [freshDevice, setFreshDevice] = useState(null); // just-created -> show code big
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [addError, setAddError] = useState('');
  const [pairDevice, setPairDevice] = useState(null); // device shown in the Pair/QR modal
  const [linkCopied, setLinkCopied] = useState(false);
  const [confirmRegenId, setConfirmRegenId] = useState(null); // two-tap confirm for code regeneration
  const [regenBusy, setRegenBusy] = useState(false);

  // Rotate the pairing code: old code dies immediately, one NEW kiosk may pair.
  // The currently-paired kiosk is unaffected (it uses its stored device_id).
  const regenerateCode = async (d) => {
    setRegenBusy(true);
    try {
      const r = await api.post(`/devices/${d.id}/regenerate-code`);
      setConfirmRegenId(null);
      refetch();
      if (pairDevice?.id === d.id) setPairDevice(r.data); // refresh the QR if its modal is open
      toast(`New code for "${d.name}" — the old one no longer works`);
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to regenerate code', 'error');
    } finally {
      setRegenBusy(false);
    }
  };

  const pairUrl = (d) => `${window.location.origin}/kiosk?pair=${d.pair_code}`;
  const copyPairLink = (d) => {
    navigator.clipboard.writeText(pairUrl(d));
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const { data: devices, refetch, isError: devicesFailed, error: devicesError } = useQuery('devices', () =>
    api.get('/devices').then(r => r.data),
    { refetchInterval: 15000, retry: 1 } // keep online status fresh
  );

  const addDevice = async (e) => {
    e.preventDefault();
    if (!newName.trim()) {
      setAddError('Give your kiosk a name first — e.g. "Front Desk iPad" or "Warehouse Kiosk"');
      return;
    }
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
          <button type="submit" disabled={adding}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderRadius: 10, background: adding ? '#94A3B8' : '#0D7377', border: 'none', color: '#fff', fontWeight: 600, cursor: adding ? 'wait' : 'pointer', fontSize: 14 }}>
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
          <div style={{ fontSize: 15, opacity: 0.85, marginBottom: 12 }}>Pairing code for <strong>{freshDevice.name}</strong></div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 28, flexWrap: 'wrap', marginBottom: 14 }}>
            <div style={{ background: '#fff', borderRadius: 14, padding: 12 }}>
              <QRCodeCanvas value={pairUrl(freshDevice)} size={130} includeMargin={false} />
            </div>
            <div style={{
              fontSize: 40, fontWeight: 800, letterSpacing: 10, fontFamily: 'monospace',
              color: '#14FFEC'
            }}>
              {freshDevice.pair_code}
            </div>
          </div>
          <div style={{ fontSize: 13, opacity: 0.7, maxWidth: 520, margin: '0 auto 16px' }}>
            <strong>Scan the QR with the kiosk tablet's camera</strong> and open the link — it pairs itself, no typing.
            Or tap <strong>"Pair this kiosk"</strong> at the bottom of the kiosk screen and enter the code.
            The device shows as online within a minute.
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
        {devicesFailed ? (
          /* A failed load must NEVER look like "no devices" — that sends admins
             re-adding kiosks that already exist */
          <div style={{ padding: 40, textAlign: 'center' }}>
            <WifiOff size={36} color="#FCA5A5" style={{ margin: '0 auto 12px' }} />
            <div style={{ fontWeight: 700, color: '#991B1B', marginBottom: 6 }}>Couldn't load your kiosks</div>
            <div style={{ fontSize: 13, color: '#B91C1C', marginBottom: 16 }}>
              {devicesError?.response?.data?.error || 'Check your connection and try again'}
            </div>
            <button onClick={() => refetch()}
              style={{ padding: '9px 22px', borderRadius: 10, background: '#0D7377', border: 'none', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              Retry
            </button>
          </div>
        ) : (!devices || devices.length === 0) ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#64748B' }}>
            <Monitor size={40} color="#CBD5E1" style={{ margin: '0 auto 12px' }} />
            <div style={{ fontWeight: 600, color: '#334155', marginBottom: 4 }}>No kiosks registered yet</div>
            <div style={{ fontSize: 14, maxWidth: 420, margin: '0 auto' }}>
              Add your first kiosk above, then open its pairing link (or scan the QR) on the tablet or
              browser you want to use. Pairing updates the kiosk listed here — it doesn't create a new one.
            </div>
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

            {canManage && (
              <button
                onClick={async () => {
                  const want = !d.print_badge;
                  try {
                    // Send the current name along: older backends require it and
                    // would otherwise reject the toggle with "Device name is required"
                    const r = await api.patch(`/devices/${d.id}`, { name: d.name, print_badge: want });
                    if (r.data && r.data.print_badge !== want) {
                      toast('Server accepted the update but ignored the printer flag — deploy the latest devices backend first', 'error');
                      return;
                    }
                    refetch();
                    toast(want ? `Printer linked to "${d.name}"` : `Printer unlinked from "${d.name}"`);
                  } catch (err) {
                    toast(err.response?.data?.error || 'Failed to update device', 'error');
                  }
                }}
                title={d.print_badge ? 'Badge printer linked — badges auto-print at this kiosk on check-in' : 'Link a badge printer at this kiosk'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8,
                  border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  background: d.print_badge ? '#0D7377' : '#F1F5F9',
                  color: d.print_badge ? '#fff' : '#64748B'
                }}>
                <Printer size={14} /> {d.print_badge ? 'Printer linked' : 'Link printer'}
              </button>
            )}

            {canManage && d.print_badge && (
              <button onClick={() => testPrint(d)} title="Print a sample badge from THIS browser to verify the printer chain"
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, background: '#FFFBEB', border: '1px solid #FDE68A', fontSize: 12, fontWeight: 700, color: '#B45309', cursor: 'pointer' }}>
                Test print
              </button>
            )}

            <button onClick={() => setPairDevice(d)} title="Show pairing QR code"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, background: '#0D7377', border: 'none', fontSize: 13, fontWeight: 600, color: '#fff', cursor: 'pointer' }}>
              <QrCode size={14} /> Pair
            </button>

            <button onClick={() => copyCode(d)} title="Copy pairing code"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 8, background: '#F8FAFC', border: '1px solid #E2E8F0', fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: '#334155', cursor: 'pointer', letterSpacing: 2 }}>
              {copiedId === d.id ? <Check size={14} color="#166534" /> : <Copy size={14} />} {d.pair_code}
            </button>

            {canManage && (confirmRegenId === d.id ? (
              <>
                <button onClick={() => regenerateCode(d)} disabled={regenBusy}
                  style={{ padding: '8px 10px', borderRadius: 8, background: '#D97706', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  {regenBusy ? 'Working…' : 'New code'}
                </button>
                <button onClick={() => setConfirmRegenId(null)}
                  style={{ padding: '8px 10px', borderRadius: 8, background: '#F1F5F9', border: 'none', fontSize: 12, cursor: 'pointer' }}>
                  Cancel
                </button>
              </>
            ) : (
              <button onClick={() => setConfirmRegenId(d.id)}
                title="Regenerate the pairing code — the old code stops working instantly. Use when replacing the tablet or if the code was shared too widely."
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 12px', borderRadius: 8, background: '#FFFBEB', border: '1px solid #FDE68A', fontSize: 12, fontWeight: 700, color: '#B45309', cursor: 'pointer' }}>
                <RotateCcw size={13} /> Regenerate
              </button>
            ))}

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

      {/* Pair / QR modal */}
      {pairDevice && (
        <div onClick={() => setPairDevice(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 20, padding: 32, width: '100%', maxWidth: 420,
            boxShadow: '0 25px 80px rgba(0,0,0,0.35)', textAlign: 'center',
            maxHeight: '90vh', overflowY: 'auto'
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', marginBottom: 4 }}>Pair "{pairDevice.name}"</h2>
            <p style={{ fontSize: 13, color: '#64748B', marginBottom: 20 }}>
              Easiest: point the kiosk tablet's camera at this QR code and open the link — it pairs itself. No typing.
            </p>
            {pairDevice.paired_at ? (
              <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#92400E', lineHeight: 1.5, textAlign: 'left' }}>
                <strong>This kiosk is already paired.</strong> Codes are single-use — this QR will be rejected on another tablet.
                To pair a replacement, tap <strong>Regenerate</strong> on the device row first (the old code dies instantly), then scan the new QR.
              </div>
            ) : (
              <div style={{ background: '#F0FDFA', border: '1px solid #99F6E4', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#0F766E', lineHeight: 1.5, textAlign: 'left' }}>
                <strong>One code pairs one kiosk.</strong> After it's used, pairing another tablet requires a fresh code (Regenerate) — this keeps kiosks from being cloned.
              </div>
            )}
            <div style={{ background: '#fff', border: '2px solid #E2E8F0', borderRadius: 16, padding: 16, display: 'inline-block', marginBottom: 16 }}>
              <QRCodeCanvas value={pairUrl(pairDevice)} size={200} includeMargin={false} />
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, background: '#F8FAFC',
              border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 14px', marginBottom: 12
            }}>
              <span style={{ flex: 1, fontSize: 12, color: '#475569', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
                {pairUrl(pairDevice)}
              </span>
              <button onClick={() => copyPairLink(pairDevice)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 8, background: linkCopied ? '#DCFCE7' : '#0D7377', border: 'none', color: linkCopied ? '#166534' : '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
                {linkCopied ? <Check size={13} /> : <Copy size={13} />} {linkCopied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p style={{ fontSize: 12, color: '#94A3B8', marginBottom: 6 }}>
              On the tablet already showing the kiosk? Tap <strong>"Pair this kiosk"</strong> at the bottom of its screen and type:
            </p>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 8, fontFamily: 'monospace', color: '#0D7377', marginBottom: 18 }}>
              {pairDevice.pair_code}
            </div>
            <button onClick={() => setPairDevice(null)}
              style={{ width: '100%', padding: '13px', borderRadius: 10, background: '#F1F5F9', border: 'none', fontWeight: 600, cursor: 'pointer' }}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
