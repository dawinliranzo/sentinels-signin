import React, { useState, useRef, useEffect } from 'react';
import { useQuery } from 'react-query';
import { Plus, Search, Mail, Phone, Pencil, Trash2, Bell, Printer, Camera, X, Upload } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import api from '../utils/api';
import { toast } from '../utils/toast';
import { useStore } from '../utils/store';

export default function Hosts() {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '', department: '', job_title: '', notify_email: true, notify_sms: false });
  const [printHost, setPrintHost] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const org = useStore((s) => s.organization);

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
    const win = window.open('', '_blank', 'width=420,height=640');
    win.document.write(`<!doctype html><html><head><title>ID Badge - ${host.first_name} ${host.last_name}</title></head>
      <body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:Arial,sans-serif;background:#f1f5f9">
      <div style="width:340px;border-radius:20px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,0.2);background:#fff;text-align:center">
        <div style="background:linear-gradient(135deg,#0D7377,#14919B);padding:24px;color:#fff">
          <div style="font-size:13px;letter-spacing:2px;opacity:0.8">${orgName.toUpperCase()}</div>
          <div style="font-size:12px;margin-top:4px;opacity:0.7">EMPLOYEE BADGE</div>
        </div>
        <div style="padding:28px 24px">
          ${host.photo_data
            ? `<img src="${host.photo_data}" style="width:72px;height:72px;border-radius:50%;object-fit:cover;margin:0 auto 14px" />`
            : `<div style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#0D7377,#14FFEC);margin:0 auto 14px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:26px;font-weight:700">${host.first_name[0]}${host.last_name[0]}</div>`}
          <div style="font-size:22px;font-weight:700;color:#0F172A">${host.first_name} ${host.last_name}</div>
          <div style="font-size:13px;color:#64748B;margin:4px 0 20px">${host.job_title || ''}${host.department ? ' · ' + host.department : ''}</div>
          <img src="${qrUrl}" style="width:200px;height:200px" />
          <div style="font-size:12px;color:#64748B;margin-top:14px">Scan at the kiosk to check in / out</div>
        </div>
        <div style="background:#F8FAFC;padding:12px;font-size:11px;color:#94A3B8">Sentinels Sign-In</div>
      </div>
      <script>window.onload=function(){window.print()}<\/script></body></html>`);
    win.document.close();
  };

  const { data: hosts, refetch } = useQuery('hosts', () =>
    api.get('/hosts').then(r => r.data)
  );

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

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0F172A' }}>Hosts</h1>
          <p style={{ color: '#64748B', marginTop: 4 }}>Manage employees who receive visitors</p>
        </div>
        <button
          onClick={() => { setEditing(null); setForm({ first_name: '', last_name: '', email: '', phone: '', department: '', job_title: '', notify_email: true, notify_sms: false, photo_data: null }); setShowModal(true); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 24px', borderRadius: 12,
            background: '#0D7377', border: 'none', color: '#fff',
            fontWeight: 600, cursor: 'pointer', fontSize: 14
          }}
        >
          <Plus size={18} /> Add Host
        </button>
      </div>

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
                    <button onClick={() => setPrintHost(h)} title="Print ID badge"
                      style={{ padding: 8, borderRadius: 8, background: '#ECFEFF', border: 'none', cursor: 'pointer' }}>
                      <Printer size={16} color="#0D7377" />
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
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
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

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <input type="text" placeholder="First Name" required value={form.first_name}
                  onChange={(e) => setForm({...form, first_name: e.target.value})} style={inputStyle} />
                <input type="text" placeholder="Last Name" required value={form.last_name}
                  onChange={(e) => setForm({...form, last_name: e.target.value})} style={inputStyle} />
              </div>
              <input type="email" placeholder="Email" required value={form.email}
                onChange={(e) => setForm({...form, email: e.target.value})} style={inputStyle} />
              <input type="tel" placeholder="Phone" value={form.phone}
                onChange={(e) => setForm({...form, phone: e.target.value})} style={inputStyle} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <input type="text" placeholder="Department" value={form.department}
                  onChange={(e) => setForm({...form, department: e.target.value})} style={inputStyle} />
                <input type="text" placeholder="Job Title" value={form.job_title}
                  onChange={(e) => setForm({...form, job_title: e.target.value})} style={inputStyle} />
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
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }}>
          <div style={{
            background: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 380,
            boxShadow: '0 25px 80px rgba(0,0,0,0.3)', textAlign: 'center'
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Employee ID Badge</h2>

            {/* Badge preview */}
            <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid #E2E8F0', marginBottom: 20 }}>
              <div style={{ background: 'linear-gradient(135deg, #0D7377, #14919B)', padding: '14px', color: '#fff' }}>
                <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.85 }}>{(org?.name || 'Organization').toUpperCase()}</div>
                <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>EMPLOYEE BADGE</div>
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
                <div style={{ fontSize: 12, color: '#64748B', margin: '2px 0 14px' }}>
                  {printHost.job_title || ''}{printHost.department ? ` · ${printHost.department}` : ''}
                </div>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
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
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
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
    </div>
  );
}
