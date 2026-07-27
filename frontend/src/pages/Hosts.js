import React, { useState, useRef, useEffect } from 'react';
import { useQuery } from 'react-query';
import { Plus, Search, Mail, Phone, Pencil, Trash2, Bell, Printer, Camera, X, Upload, FileSpreadsheet, Nfc, Share2, Building2 } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import api from '../utils/api';
import useRfidTap from '../utils/useRfidTap';
import { toast } from '../utils/toast';
import { useStore } from '../utils/store';
import { getTerms } from '../utils/terms';

export default function Hosts() {
  const user = useStore((st) => st.user);
  const terms = getTerms(user?.profile_type);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '', department: '', job_title: '', notify_email: true, notify_sms: false });
  const [printHost, setPrintHost] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  // Which optional fields appear on the printed badge (name, photo, QR always show)
  const defaultBadgeFields = { job_title: true, department: true, email: false, phone: false };
  const [badgeFields, setBadgeFields] = useState(defaultBadgeFields);
  // What the org calls these people (Settings → Badge label), printed on badges
  const [badgeLabel, setBadgeLabel] = useState('');
  // Bulk import + bulk print
  const importInputRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [printAllHosts, setPrintAllHosts] = useState(null);

  useEffect(() => {
    api.get('/settings').then(r => setBadgeLabel((r.data?.badge_label || '').trim())).catch(() => {});
  }, []);

  const badgeTitle = (badgeLabel || terms.badgeTitle).toUpperCase();

  // ─── RFID cards: enroll a physical card/fob so this host can tap in/out ───
  const [rfidHost, setRfidHost] = useState(null); // host whose cards are being managed
  const [rfidUid, setRfidUid] = useState('');
  const [rfidBusy, setRfidBusy] = useState(false);
  const [rfidMsg, setRfidMsg] = useState(null);
  const [rfidConfirmDelete, setRfidConfirmDelete] = useState(null);

  const { data: allRfidCards, refetch: refetchRfid } = useQuery('rfid-cards',
    () => api.get('/rfid-cards').then(r => r.data),
    { retry: false }
  );
  const hostCards = (allRfidCards || []).filter(card => card.card_type === 'staff' && card.host_id === rfidHost?.id);

  const enrollCard = async (uidFromTap) => {
    const uid = (uidFromTap || rfidUid).trim();
    if (!uid) { setRfidMsg({ ok: false, text: 'Tap a card on the reader, or type its UID' }); return; }
    setRfidBusy(true);
    setRfidMsg(null);
    try {
      await api.post('/rfid-cards', { uid, card_type: 'staff', host_id: rfidHost.id });
      setRfidMsg({ ok: true, text: `Card ${uid} enrolled — ${rfidHost.first_name} can now tap in and out` });
      setRfidUid('');
      refetchRfid();
    } catch (err) {
      setRfidMsg({ ok: false, text: err.response?.data?.error || 'Failed to enroll card' });
    } finally {
      setRfidBusy(false);
    }
  };

  // Tap-to-enroll: while the card modal is open, a reader burst fills the UID
  useRfidTap((uid) => { setRfidUid(uid); setRfidMsg({ ok: true, text: `Card detected: ${uid} — press Enroll to save` }); },
    { enabled: !!rfidHost });

  const deleteCard = async (id) => {
    try {
      await api.delete(`/rfid-cards/${id}`);
      setRfidConfirmDelete(null);
      refetchRfid();
    } catch (err) {
      setRfidMsg({ ok: false, text: err.response?.data?.error || 'Failed to remove card' });
    }
  };
  const org = useStore((s) => s.organization);

  // ─── CSV bulk import ───
  const downloadTemplate = () => {
    const csv = 'first_name,last_name,email,phone,department,job_title,notes\n' +
                'Jane,Doe,jane.doe@company.com,+13475550100,Front Desk,Receptionist,Has a package waiting\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'hosts-import-template.csv';
    a.click();
  };

  // Minimal CSV parser that handles quoted fields with commas
  const parseCSV = (text) => {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(cell => cell.trim() !== '')) rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); if (row.some(cell => cell.trim() !== '')) rows.push(row); }
    if (rows.length < 2) return [];
    const headers = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
    return rows.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] || '').trim()])));
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length === 0) {
      return toast('No valid rows found — download the CSV template to see the required columns', 'error');
    }
    setImporting(true);
    setImportResult(null);
    try {
      const r = await api.post('/hosts/import', { rows });
      setImportResult(r.data);
      refetch();
    } catch (err) {
      toast(err.response?.data?.error || 'Import failed', 'error');
    } finally {
      setImporting(false);
    }
  };

  // ─── Print all badges: hidden QRs render first, then collect into one document ───
  useEffect(() => {
    if (!printAllHosts) return;
    const timer = setTimeout(() => {
      const orgName = org?.name || 'Organization';
      const cards = printAllHosts.map(h => {
        const canvas = document.getElementById(`bulk-qr-${h.id}`);
        const qrUrl = canvas ? canvas.toDataURL('image/png') : '';
        const photoHtml = h.photo_data
          ? `<img src="${h.photo_data}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;margin:0 auto 10px" />`
          : `<div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#0D7377,#14FFEC);margin:0 auto 10px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;font-weight:700">${h.first_name[0]}${h.last_name[0]}</div>`;
        return `<div style="width:320px;border-radius:18px;overflow:hidden;border:1px solid #E2E8F0;background:#fff;text-align:center;page-break-inside:avoid">
          <div style="background:linear-gradient(135deg,#0D7377,#14919B);padding:16px;color:#fff">
            <div style="font-size:11px;letter-spacing:2px;opacity:0.85">${orgName.toUpperCase()}</div>
            <div style="font-size:11px;margin-top:3px;opacity:0.7">${badgeTitle}</div>
          </div>
          <div style="padding:20px">
            ${photoHtml}
            <div style="font-size:19px;font-weight:700;color:#0F172A">${h.first_name} ${h.last_name}</div>
            <div style="font-size:12px;color:#64748B;margin:3px 0 14px">${[h.job_title, h.department].filter(Boolean).join(' · ')}</div>
            <img src="${qrUrl}" style="width:170px;height:170px" />
            <div style="font-size:11px;color:#64748B;margin-top:10px">Scan at the kiosk to check in / out</div>
          </div>
        </div>`;
      }).join('');
      const win = window.open('', '_blank', 'width=1100,height=800');
      win.document.write(`<!doctype html><html><head><title>All Badges - ${orgName}</title></head>
        <body style="margin:0;padding:24px;font-family:Arial,sans-serif;background:#f1f5f9">
        <div style="display:flex;flex-wrap:wrap;gap:20px;justify-content:center">${cards}</div>
        <script>window.onload=function(){window.print()}<\/script></body></html>`);
      win.document.close();
      setPrintAllHosts(null);
    }, 400); // give the hidden QR canvases a moment to render
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printAllHosts]);

  // Resize an uploaded/taken photo to a small JPEG data URL (keeps DB + payloads light)
  const processPhoto = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 320;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handlePhotoPick = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const dataUrl = await processPhoto(file);
      setForm((f) => ({ ...f, photo_data: dataUrl }));
    } catch {
      toast('Could not read that image', 'error');
    }
    e.target.value = '';
  };

  // ─── Take photo with device camera ───
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraShot, setCameraShot] = useState(null); // captured frame pending accept
  const [cameraReady, setCameraReady] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  };

  const openCamera = async () => {
    setCameraShot(null);
    setCameraOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640 } });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraReady(true);
    } catch {
      setCameraOpen(false);
      toast('Camera not available — check browser permissions, or upload a photo instead', 'error');
    }
  };

  const closeCamera = () => { stopCamera(); setCameraOpen(false); setCameraShot(null); };

  const captureShot = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const MAX = 320;
    const scale = Math.min(1, MAX / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    setCameraShot(canvas.toDataURL('image/jpeg', 0.75));
  };

  const acceptShot = () => {
    setForm((f) => ({ ...f, photo_data: cameraShot }));
    closeCamera();
  };

  // Stop the camera if the whole modal unmounts
  useEffect(() => () => stopCamera(), []);

  // Attach stream whenever the video element (re)renders (modal open / retake)
  useEffect(() => {
    if (cameraOpen && !cameraShot && streamRef.current && videoRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraOpen, cameraShot, cameraReady]);

  const handlePrint = (host) => {
    const canvas = document.getElementById(`badge-qr-${host.id}`);
    const qrUrl = canvas ? canvas.toDataURL('image/png') : '';
    const orgName = org?.name || 'Organization';

    // Build the optional detail lines from the selected badge fields
    const titleParts = [];
    if (badgeFields.job_title && host.job_title) titleParts.push(host.job_title);
    if (badgeFields.department && host.department) titleParts.push(host.department);
    const contactParts = [];
    if (badgeFields.email && host.email) contactParts.push(host.email);
    if (badgeFields.phone && host.phone) contactParts.push(host.phone);

    const win = window.open('', '_blank', 'width=420,height=640');
    win.document.write(`<!doctype html><html><head><title>ID Badge - ${host.first_name} ${host.last_name}</title></head>
      <body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:Arial,sans-serif;background:#f1f5f9">
      <div style="width:340px;border-radius:20px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,0.2);background:#fff;text-align:center">
        <div style="background:linear-gradient(135deg,#0D7377,#14919B);padding:24px;color:#fff">
          <div style="font-size:13px;letter-spacing:2px;opacity:0.8">${orgName.toUpperCase()}</div>
          <div style="font-size:12px;margin-top:4px;opacity:0.7">${badgeTitle}</div>
        </div>
        <div style="padding:28px 24px">
          ${host.photo_data
            ? `<img src="${host.photo_data}" style="width:72px;height:72px;border-radius:50%;object-fit:cover;margin:0 auto 14px" />`
            : `<div style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#0D7377,#14FFEC);margin:0 auto 14px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:26px;font-weight:700">${host.first_name[0]}${host.last_name[0]}</div>`}
          <div style="font-size:22px;font-weight:700;color:#0F172A">${host.first_name} ${host.last_name}</div>
          <div style="font-size:13px;color:#64748B;margin:4px 0 ${contactParts.length ? '2px' : '20px'}">${titleParts.join(' · ')}</div>
          ${contactParts.length ? `<div style="font-size:12px;color:#94A3B8;margin:0 0 20px">${contactParts.join(' · ')}</div>` : ''}
          <img src="${qrUrl}" style="width:200px;height:200px" />
          <div style="font-size:12px;color:#64748B;margin-top:14px">Scan at the kiosk to check in / out</div>
        </div>
        <div style="background:#F8FAFC;padding:12px;font-size:11px;color:#94A3B8">Sentinels Kiosk</div>
      </div>
      <script>window.onload=function(){window.print()}<\/script></body></html>`);
    win.document.close();
  };

  const { data: hosts, refetch } = useQuery('hosts', () =>
    api.get('/hosts').then(r => r.data)
  );

  // Organization family: parent/child relationships + inherited staff
  const { data: family, refetch: refetchFamily } = useQuery('org-family', () =>
    api.get('/hosts/family').then(r => r.data)
  );

  const toggleShare = async (h) => {
    try {
      await api.put(`/hosts/${h.id}`, { shared_with_children: !h.shared_with_children });
      refetch();
      toast(h.shared_with_children ? `${h.first_name} is no longer shared` : `${h.first_name} is now available at your other locations`);
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to update sharing', 'error');
    }
  };

  const toggleSharedAllowed = async (sh) => {
    try {
      await api.put(`/hosts/shared/${sh.id}`, { allowed: !sh.allowed });
      refetchFamily();
      toast(sh.allowed ? `${sh.first_name} disabled at this location` : `${sh.first_name} enabled at this location`);
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to update shared staff', 'error');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await api.put(`/hosts/${editing}`, form);
      } else {
        await api.post('/hosts', form);
      }
      setShowModal(false);
      setEditing(null);
      setForm({ first_name: '', last_name: '', email: '', phone: '', department: '', job_title: '', notify_email: true, notify_sms: false, photo_data: null });
      refetch();
      toast(editing ? 'Host updated' : 'Host added');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to save host', 'error');
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/hosts/${id}`);
      setConfirmDeleteId(null);
      refetch();
      toast('Host deleted');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to delete host', 'error');
    }
  };

  const inputStyle = {
    width: '100%', padding: '12px 16px', borderRadius: 10,
    border: '2px solid #E2E8F0', fontSize: 14, outline: 'none'
  };

  const hintStyle = {
    fontSize: 11, color: '#94A3B8', marginTop: 4, lineHeight: 1.4
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
        <div style={{ flex: '1 1 280px', minWidth: 220 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0F172A' }}>{terms.hostPageTitle}</h1>
          <p style={{ color: '#64748B', marginTop: 4, maxWidth: 520 }}>{terms.hostPageSub}. The badge label is set in Settings.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
          {[
            { label: 'CSV Template', icon: FileSpreadsheet, onClick: downloadTemplate, show: true },
            { label: importing ? 'Importing…' : 'Import CSV', icon: Upload, onClick: () => importInputRef.current?.click(), show: true, disabled: importing },
            { label: 'Print All Badges', icon: Printer, onClick: () => setPrintAllHosts(hosts), show: hosts?.length > 0 },
          ].filter(b => b.show).map((b, i) => (
            <button key={i} onClick={b.onClick} disabled={b.disabled}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                height: 40, padding: '0 14px', borderRadius: 10,
                background: '#fff', border: '1px solid #CBD5E1', color: '#334155',
                fontWeight: 600, cursor: b.disabled ? 'not-allowed' : 'pointer', fontSize: 13,
                whiteSpace: 'nowrap', opacity: b.disabled ? 0.6 : 1
              }}>
              <b.icon size={15} /> {b.label}
            </button>
          ))}
          <input ref={importInputRef} type="file" accept=".csv,text/csv" onChange={handleImportFile} style={{ display: 'none' }} />
          <button
            onClick={() => { setEditing(null); setForm({ first_name: '', last_name: '', email: '', phone: '', department: '', job_title: '', notify_email: true, notify_sms: false, photo_data: null, notes: '' }); setShowModal(true); }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              height: 40, padding: '0 16px', borderRadius: 10,
              background: '#0D7377', border: '1px solid #0D7377', color: '#fff',
              fontWeight: 600, cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap'
            }}
          >
            <Plus size={16} /> {terms.addHost}
          </button>
        </div>
      </div>

      {/* Import result summary */}
      {importResult && (
        <div style={{ padding: 16, borderRadius: 12, marginBottom: 16, background: importResult.errors > 0 ? '#FFFBEB' : '#ECFDF5', border: `1px solid ${importResult.errors > 0 ? '#FDE68A' : '#A7F3D0'}` }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#0F172A', marginBottom: 4 }}>
            Import complete: {importResult.created} added · {importResult.skipped} skipped (duplicates) · {importResult.errors} failed
          </div>
          {importResult.detail?.errors?.slice(0, 5).map((e, i) => (
            <div key={i} style={{ fontSize: 12, color: '#92400E' }}>Row {e.line}: {e.reason}</div>
          ))}
          <button onClick={() => setImportResult(null)} style={{ marginTop: 8, padding: '6px 12px', borderRadius: 8, background: 'transparent', border: '1px solid #CBD5E1', fontSize: 12, cursor: 'pointer' }}>Dismiss</button>
        </div>
      )}

      {/* Hidden QR canvases for Print All — collected into one print document */}
      {printAllHosts && (
        <div style={{ position: 'fixed', left: -99999, top: 0, width: 1, overflow: 'hidden' }}>
          {printAllHosts.map(h => (
            <QRCodeCanvas key={h.id} id={`bulk-qr-${h.id}`} value={`STAFF:${h.id}`} size={200} level="M" includeMargin />
          ))}
        </div>
      )}

      {/* ── Organization family: shared staff across locations ── */}
      {family && !family.migrationPending && family.role !== 'standalone' && (
        <div style={{
          background: '#fff', borderRadius: 20, padding: 20, marginBottom: 20,
          boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <Building2 size={18} color="#0D7377" />
            <span style={{ fontSize: 16, fontWeight: 800, color: '#0F172A' }}>
              {family.role === 'child' ? `Part of ${family.parent?.name}` : 'Your locations'}
            </span>
          </div>
          {family.role === 'parent' && (
            <div>
              <p style={{ fontSize: 13, color: '#64748B', margin: '4px 0 10px' }}>
                This organization is the parent of: <strong>{family.children.map(c => c.name).join(', ')}</strong>.
                Use the share button on any {terms.hostLower} below to make them available at those locations — they'll sign in with the same badge, QR code, or RFID card.
              </p>
            </div>
          )}
          {family.role === 'child' && (
            <div>
              <p style={{ fontSize: 13, color: '#64748B', margin: '4px 0 10px' }}>
                {terms.hosts} shared by <strong>{family.parent?.name}</strong> can sign in here with their usual badge, QR code, or RFID card. Disable anyone who should not have access at this location.
              </p>
              {family.sharedHosts.length === 0 ? (
                <div style={{ fontSize: 13, color: '#94A3B8', fontStyle: 'italic' }}>No shared {terms.hostsLower} yet — nothing has been shared from {family.parent?.name}.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {family.sharedHosts.map(sh => (
                    <div key={sh.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 14px', borderRadius: 10, background: sh.allowed ? '#F0FDFA' : '#F8FAFC', border: `1px solid ${sh.allowed ? '#99F6E4' : '#E2E8F0'}`, flexWrap: 'wrap' }}>
                      <div>
                        <span style={{ fontWeight: 700, fontSize: 14, color: '#0F172A' }}>{sh.first_name} {sh.last_name}</span>
                        <span style={{ fontSize: 12, color: '#64748B', marginLeft: 8 }}>{sh.job_title || sh.department || ''}</span>
                      </div>
                      <button onClick={() => toggleSharedAllowed(sh)}
                        style={{
                          padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                          border: 'none', background: sh.allowed ? '#0D7377' : '#CBD5E1', color: sh.allowed ? '#fff' : '#475569'
                        }}>
                        {sh.allowed ? 'Allowed here' : 'Blocked here'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {family.role === 'parent' && family.sharedHosts.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Shared by your locations</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {family.sharedHosts.map(sh => (
                  <div key={sh.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 14px', borderRadius: 10, background: sh.allowed ? '#F0FDFA' : '#F8FAFC', border: `1px solid ${sh.allowed ? '#99F6E4' : '#E2E8F0'}`, flexWrap: 'wrap' }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 14, color: '#0F172A' }}>{sh.first_name} {sh.last_name}</span>
                      <span style={{ fontSize: 12, color: '#64748B', marginLeft: 8 }}>from {sh.owner_org_name}</span>
                    </div>
                    <button onClick={() => toggleSharedAllowed(sh)}
                      style={{
                        padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        border: 'none', background: sh.allowed ? '#0D7377' : '#CBD5E1', color: sh.allowed ? '#fff' : '#475569'
                      }}>
                      {sh.allowed ? 'Allowed here' : 'Blocked here'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{
        background: '#fff', borderRadius: 20, overflow: 'auto',
        boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#F8FAFC' }}>
              {['Name', 'Department', 'Contact', 'Notifications', 'Actions'].map(h => (
                <th key={h} style={{ padding: '16px 20px', textAlign: 'left', fontSize: 13, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hosts?.map(h => (
              <tr key={h.id} style={{ borderTop: '1px solid #E2E8F0' }}>
                <td style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {h.photo_data ? (
                      <img src={h.photo_data} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{
                        width: 40, height: 40, borderRadius: '50%',
                        background: 'linear-gradient(135deg, #0D7377, #14FFEC)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 700, fontSize: 14, color: '#fff'
                      }}>
                        {h.first_name[0]}{h.last_name[0]}
                      </div>
                    )}
                    <div>
                      <div style={{ fontWeight: 600, color: '#0F172A', fontSize: 14 }}>{h.first_name} {h.last_name}</div>
                      <div style={{ fontSize: 12, color: '#64748B' }}>{h.job_title || 'No title'}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '16px 20px', fontSize: 14, color: '#334155' }}>{h.department || '-'}</td>
                <td style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748B' }}>
                      <Mail size={12} /> {h.email}
                    </span>
                    {h.phone && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748B' }}>
                        <Phone size={12} /> {h.phone}
                      </span>
                    )}
                  </div>
                </td>
                <td style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {h.notify_email && <span style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, background: '#DCFCE7', color: '#166534' }}>Email</span>}
                    {h.notify_sms && <span style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, background: '#DBEAFE', color: '#1E40AF' }}>SMS</span>}
                  </div>
                </td>
                <td style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {family && !family.migrationPending && family.role !== 'standalone' && (
                      <button onClick={() => toggleShare(h)}
                        title={h.shared_with_children ? 'Shared with your other locations — click to unshare' : 'Share with your other locations'}
                        style={{
                          padding: 8, borderRadius: 8, border: 'none', cursor: 'pointer',
                          background: h.shared_with_children ? '#0D7377' : '#F1F5F9'
                        }}>
                        <Share2 size={16} color={h.shared_with_children ? '#fff' : '#64748B'} />
                      </button>
                    )}
                    <button onClick={() => { setBadgeFields(defaultBadgeFields); setPrintHost(h); }} title="Print ID badge"
                      style={{ padding: 8, borderRadius: 8, background: '#ECFEFF', border: 'none', cursor: 'pointer' }}>
                      <Printer size={16} color="#0D7377" />
                    </button>
                    <button onClick={() => { setRfidHost(h); setRfidUid(''); setRfidMsg(null); setRfidConfirmDelete(null); }} title="Manage RFID cards"
                      style={{ padding: 8, borderRadius: 8, background: '#FEF3C7', border: 'none', cursor: 'pointer' }}>
                      <Nfc size={16} color="#B45309" />
                    </button>
                    <button onClick={() => { setEditing(h.id); setForm(h); setShowModal(true); }} title="Edit"
                      style={{ padding: 8, borderRadius: 8, background: '#F1F5F9', border: 'none', cursor: 'pointer' }}>
                      <Pencil size={16} color="#64748B" />
                    </button>
                    {confirmDeleteId === h.id ? (
                      <span style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => handleDelete(h.id)}
                          style={{ padding: '8px 10px', borderRadius: 8, background: '#EF4444', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                          Confirm
                        </button>
                        <button onClick={() => setConfirmDeleteId(null)}
                          style={{ padding: '8px 10px', borderRadius: 8, background: '#F1F5F9', border: 'none', fontSize: 12, cursor: 'pointer' }}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmDeleteId(h.id)} title="Delete"
                        style={{ padding: 8, borderRadius: 8, background: '#FEF2F2', border: 'none', cursor: 'pointer' }}>
                        <Trash2 size={16} color="#EF4444" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="responsive-modal"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }}>
          <div style={{
            background: '#fff', borderRadius: 20, padding: 32, width: '100%', maxWidth: 500,
            boxShadow: '0 25px 80px rgba(0,0,0,0.3)', maxHeight: '90vh', overflowY: 'auto'
          }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>
              {editing ? 'Edit Host' : 'Add New Host'}
            </h2>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Photo */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {form.photo_data ? (
                  <img src={form.photo_data} alt="" style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', border: '2px solid #E2E8F0' }} />
                ) : (
                  <div style={{
                    width: 72, height: 72, borderRadius: '50%', flexShrink: 0,
                    background: '#F1F5F9', border: '2px dashed #CBD5E1',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    <Camera size={24} color="#94A3B8" />
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <label style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      padding: '9px 16px', borderRadius: 10, background: '#F1F5F9',
                      fontSize: 13, fontWeight: 600, color: '#334155', cursor: 'pointer'
                    }}>
                      <Upload size={15} /> {form.photo_data ? 'Upload new' : 'Upload photo'}
                      <input type="file" accept="image/*" onChange={handlePhotoPick} style={{ display: 'none' }} />
                    </label>
                    <button type="button" onClick={openCamera} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      padding: '9px 16px', borderRadius: 10, background: '#0D7377',
                      border: 'none', fontSize: 13, fontWeight: 600, color: '#fff', cursor: 'pointer'
                    }}>
                      <Camera size={15} /> Take photo
                    </button>
                  </div>
                  {form.photo_data && (
                    <button type="button" onClick={() => setForm({ ...form, photo_data: null })}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start', background: 'none', border: 'none', color: '#EF4444', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
                      <X size={13} /> Remove photo
                    </button>
                  )}
                  <span style={{ fontSize: 11, color: '#94A3B8' }}>Shown on the host list, kiosk, and printed ID badge</span>
                </div>
              </div>

              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <input type="text" placeholder="First Name" required value={form.first_name}
                    onChange={(e) => setForm({...form, first_name: e.target.value})} style={inputStyle} />
                  <input type="text" placeholder="Last Name" required value={form.last_name}
                    onChange={(e) => setForm({...form, last_name: e.target.value})} style={inputStyle} />
                </div>
                <div style={hintStyle}>Shown on the kiosk host picker, in visitor-arrival notifications, and on the printed ID badge</div>
              </div>
              <div>
                <input type="email" placeholder="Email" required value={form.email}
                  onChange={(e) => setForm({...form, email: e.target.value})} style={inputStyle} />
                <div style={hintStyle}>Where "visitor arrived" email alerts are sent. Can also be printed on the badge (you choose at print time)</div>
              </div>
              <div>
                <input type="tel" placeholder="Phone" value={form.phone}
                  onChange={(e) => setForm({...form, phone: e.target.value})} style={inputStyle} />
                <div style={hintStyle}>Used for SMS arrival alerts when SMS is enabled below. Optional on the badge</div>
              </div>
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <input type="text" placeholder="Department" value={form.department}
                    onChange={(e) => setForm({...form, department: e.target.value})} style={inputStyle} />
                  <input type="text" placeholder="Job Title" value={form.job_title}
                    onChange={(e) => setForm({...form, job_title: e.target.value})} style={inputStyle} />
                </div>
                <div style={hintStyle}>Department helps visitors find the right host in kiosk search; Job Title prints under the name on the badge. Both optional on the badge</div>
              </div>
              <div>
                <textarea placeholder="Note for the security guard (optional) — e.g. 'Has a package at the front desk' or 'Payment due'"
                  value={form.notes || ''} rows={2}
                  onChange={(e) => setForm({...form, notes: e.target.value})}
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
                <div style={hintStyle}>Shown in large type on the kiosk next to this person's photo whenever they badge in</div>
              </div>
              <div style={{ display: 'flex', gap: 24, padding: '8px 0' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.notify_email}
                    onChange={(e) => setForm({...form, notify_email: e.target.checked})}
                    style={{ width: 20, height: 20 }} />
                  <span style={{ fontSize: 14, color: '#334155' }}>Email notifications</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.notify_sms}
                    onChange={(e) => setForm({...form, notify_sms: e.target.checked})}
                    style={{ width: 20, height: 20 }} />
                  <span style={{ fontSize: 14, color: '#334155' }}>SMS notifications</span>
                </label>
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <button type="button" onClick={() => setShowModal(false)}
                  style={{ flex: 1, padding: '14px', borderRadius: 10, background: '#F1F5F9', border: 'none', fontWeight: 600, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button type="submit"
                  style={{ flex: 1, padding: '14px', borderRadius: 10, background: '#0D7377', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                  {editing ? 'Update' : 'Add Host'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Print ID Badge Modal */}
      {printHost && (
        <div className="responsive-modal"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }}>
          <div style={{
            background: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 380,
            boxShadow: '0 25px 80px rgba(0,0,0,0.3)', textAlign: 'center'
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Employee ID Badge</h2>

            {/* Field picker — name, photo and QR always print */}
            <div style={{ textAlign: 'left', marginBottom: 14, padding: '12px 14px', borderRadius: 12, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 8 }}>Show on badge</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
                {[['job_title', 'Job title'], ['department', 'Department'], ['email', 'Email'], ['phone', 'Phone']].map(([key, label]) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#334155', cursor: 'pointer' }}>
                    <input type="checkbox" checked={badgeFields[key]}
                      onChange={(e) => setBadgeFields({ ...badgeFields, [key]: e.target.checked })} />
                    {label}
                  </label>
                ))}
              </div>
              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 6 }}>Name, photo, and QR code are always included.</div>
            </div>

            {/* Badge preview */}
            <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid #E2E8F0', marginBottom: 20 }}>
              <div style={{ background: 'linear-gradient(135deg, #0D7377, #14919B)', padding: '14px', color: '#fff' }}>
                <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.85 }}>{(org?.name || 'Organization').toUpperCase()}</div>
                <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>{badgeTitle}</div>
              </div>
              <div style={{ padding: '20px 16px' }}>
                {printHost.photo_data ? (
                  <img src={printHost.photo_data} alt="" style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', margin: '0 auto 10px' }} />
                ) : (
                  <div style={{
                    width: 56, height: 56, borderRadius: '50%', margin: '0 auto 10px',
                    background: 'linear-gradient(135deg, #0D7377, #14FFEC)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 20, fontWeight: 700
                  }}>
                    {printHost.first_name[0]}{printHost.last_name[0]}
                  </div>
                )}
                <div style={{ fontSize: 18, fontWeight: 700, color: '#0F172A' }}>{printHost.first_name} {printHost.last_name}</div>
                {(badgeFields.job_title || badgeFields.department) && (
                  <div style={{ fontSize: 12, color: '#64748B', margin: '2px 0 2px' }}>
                    {[badgeFields.job_title && printHost.job_title, badgeFields.department && printHost.department].filter(Boolean).join(' · ')}
                  </div>
                )}
                {(badgeFields.email || badgeFields.phone) && (
                  <div style={{ fontSize: 11, color: '#94A3B8', margin: '0 0 2px' }}>
                    {[badgeFields.email && printHost.email, badgeFields.phone && printHost.phone].filter(Boolean).join(' · ')}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
                  <QRCodeCanvas id={`badge-qr-${printHost.id}`} value={`STAFF:${printHost.id}`} size={150} level="M" includeMargin />
                </div>
                <div style={{ fontSize: 11, color: '#64748B', marginTop: 12 }}>Scan at the kiosk to check in / out</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setPrintHost(null)}
                style={{ flex: 1, padding: '13px', borderRadius: 10, background: '#F1F5F9', border: 'none', fontWeight: 600, cursor: 'pointer' }}>
                Close
              </button>
              <button onClick={() => handlePrint(printHost)}
                style={{ flex: 1, padding: '13px', borderRadius: 10, background: '#0D7377', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Printer size={16} /> Print
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Camera Modal */}
      {cameraOpen && (
        <div className="responsive-modal"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200
        }}>
          <div style={{
            background: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 480,
            boxShadow: '0 25px 80px rgba(0,0,0,0.35)', textAlign: 'center'
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Take Photo</h2>
            <div style={{
              borderRadius: 16, overflow: 'hidden', background: '#0F172A', marginBottom: 16,
              aspectRatio: '4/3', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              {cameraShot ? (
                <img src={cameraShot} alt="Captured" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              )}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={closeCamera}
                style={{ flex: 1, padding: '13px', borderRadius: 10, background: '#F1F5F9', border: 'none', fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
              {cameraShot ? (
                <>
                  <button type="button" onClick={() => setCameraShot(null)}
                    style={{ flex: 1, padding: '13px', borderRadius: 10, background: '#FEF3C7', border: 'none', color: '#92400E', fontWeight: 600, cursor: 'pointer' }}>
                    Retake
                  </button>
                  <button type="button" onClick={acceptShot}
                    style={{ flex: 1, padding: '13px', borderRadius: 10, background: '#0D7377', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                    Use Photo
                  </button>
                </>
              ) : (
                <button type="button" onClick={captureShot} disabled={!cameraReady}
                  style={{ flex: 2, padding: '13px', borderRadius: 10, background: cameraReady ? '#0D7377' : '#94A3B8', border: 'none', color: '#fff', fontWeight: 600, cursor: cameraReady ? 'pointer' : 'not-allowed' }}>
                  {cameraReady ? 'Capture' : 'Starting camera…'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* RFID cards modal — enroll / manage this host's physical cards & fobs */}
      {rfidHost && (
        <div className="responsive-modal" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}
          onClick={() => setRfidHost(null)}>
          <div style={{ background: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 520, boxShadow: '0 25px 80px rgba(0,0,0,0.3)' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <h3 style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Nfc size={20} color="#B45309" /> RFID Cards — {rfidHost.first_name} {rfidHost.last_name}
              </h3>
              <button onClick={() => setRfidHost(null)} style={{ padding: 8, borderRadius: 8, background: '#F1F5F9', border: 'none', cursor: 'pointer' }}>
                <X size={16} color="#64748B" />
              </button>
            </div>
            <p style={{ fontSize: 13, color: '#64748B', marginBottom: 16, lineHeight: 1.5 }}>
              Enrolled cards let {rfidHost.first_name} tap in and out at the kiosk.
              Plug a USB RFID reader into this computer, click the field below, and tap the card — or type the UID printed on it.
            </p>

            {/* Enroll */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
              <input
                type="text" value={rfidUid} onChange={(e) => setRfidUid(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); enrollCard(); } }}
                placeholder="Card UID (e.g. 0015238741)"
                autoFocus
                style={{ flex: 1, padding: '12px 16px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 15, fontFamily: 'monospace', fontWeight: 700 }}
              />
              <button onClick={() => enrollCard()} disabled={rfidBusy}
                style={{ padding: '12px 22px', borderRadius: 10, background: rfidBusy ? '#94A3B8' : '#0D7377', border: 'none', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                {rfidBusy ? 'Saving…' : 'Enroll'}
              </button>
            </div>
            {rfidMsg && (
              <div style={{
                fontSize: 13, fontWeight: 600, marginBottom: 12, padding: '10px 14px', borderRadius: 10,
                background: rfidMsg.ok ? '#ECFDF5' : '#FEF2F2',
                color: rfidMsg.ok ? '#065F46' : '#991B1B',
                border: `1px solid ${rfidMsg.ok ? '#A7F3D0' : '#FECACA'}`
              }}>
                {rfidMsg.text}
              </div>
            )}

            {/* Enrolled cards */}
            <div style={{ marginTop: 8 }}>
              {hostCards.length === 0 ? (
                <p style={{ fontSize: 13, color: '#94A3B8', textAlign: 'center', padding: '16px 0' }}>No cards enrolled for this host yet.</p>
              ) : hostCards.map(card => (
                <div key={card.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
                  background: '#F8FAFC', borderRadius: 10, marginBottom: 8
                }}>
                  <Nfc size={16} color={card.is_active ? '#B45309' : '#94A3B8'} />
                  <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 14, color: '#0F172A', flex: 1 }}>
                    {card.uid}
                  </span>
                  {!card.is_active && <span style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8' }}>INACTIVE</span>}
                  {rfidConfirmDelete === card.id ? (
                    <>
                      <button onClick={() => deleteCard(card.id)}
                        style={{ padding: '7px 12px', borderRadius: 8, background: '#DC2626', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                        Confirm?
                      </button>
                      <button onClick={() => setRfidConfirmDelete(null)}
                        style={{ padding: '7px 10px', borderRadius: 8, background: '#F1F5F9', border: 'none', fontSize: 12, cursor: 'pointer', color: '#64748B' }}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setRfidConfirmDelete(card.id)} title="Remove card"
                      style={{ padding: '7px 9px', borderRadius: 8, background: '#fff', border: '1px solid #FECACA', cursor: 'pointer' }}>
                      <Trash2 size={14} color="#DC2626" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
