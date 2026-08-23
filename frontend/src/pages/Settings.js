import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../utils/store';
import { PROFILE_OPTIONS, getTerms } from '../utils/terms';
import { Upload, Palette, Bell, Shield, Save, X, PenLine, HardDrive, RotateCcw, AlertTriangle , ScanFace , Webhook , KeyRound, Users, Trash2, Pencil, Plus, CreditCard, CheckCircle2 } from 'lucide-react';
import api from '../utils/api';
import { toast } from '../utils/toast';

// Default org settings blob — keep in one place so the "unsaved changes"
// tracker compares against a stable shape
const DEFAULTS = (orgName) => ({
  org_name: orgName || '',
  primary_color: '#0D7377',
  accent_color: '#FF6B35',
  notify_email: true,
  notify_sms: false,
  require_photo: false,
  require_nda: false,
  require_prereg_date: false,
  nda_text: '',
  badge_label: '',
  overstay_hours: 8,
  logo_data: '',
  custom_fields: [],
  hidden_fields: [],
});

export default function Settings() {
  const org = useStore((s) => s.organization);
  const user = useStore((s) => s.user);
  const updateUser = useStore((s) => s.updateUser);
  const canManage = user?.role === 'admin' || user?.role === 'super_admin' || user?.switched || (user?.permissions || []).includes('settings');

  // Curated kiosk theme palettes — one click recolors every kiosk screen
  // (welcome, sign-in, sign-out) via settings.primary_color + accent_color.
  const THEME_PALETTES = [
    { name: 'Sentinels Teal', primary: '#0D7377', accent: '#FF6B35', blurb: 'The default brand look' },
    { name: 'Midnight Blue',  primary: '#1D4ED8', accent: '#F59E0B', blurb: 'Corporate & calm' },
    { name: 'Royal Plum',     primary: '#7C3AED', accent: '#F97316', blurb: 'Modern & playful' },
    { name: 'Forest Green',   primary: '#15803D', accent: '#EAB308', blurb: 'Schools & campuses' },
    { name: 'Crimson Red',    primary: '#BE123C', accent: '#0EA5E9', blurb: 'Bold & urgent' },
    { name: 'Graphite Cyan',  primary: '#334155', accent: '#06B6D4', blurb: 'Sleek & minimal' },
  ];

  // ── Billing (Stripe) — fresh org billing state comes from /auth/me ──
  const BILLING_PLANS = {
    free:       { label: 'Free trial', price: 0,   color: '#64748B', perks: ['5 users', '100 visits/mo', '1 kiosk device', '14 days with every feature'] },
    pro:        { label: 'Pro',        price: 49,  color: '#0D7377', perks: ['25 users', '2,000 visits/mo', '5 kiosk devices', 'Reports & analytics', 'Compliance / NDA records', 'SMS notifications', 'Bulk host import (CSV)'] },
    enterprise: { label: 'Enterprise', price: 149, color: '#FF6B35', perks: ['1,000 users', '100,000 visits/mo', '50 kiosk devices', 'Everything in Pro', 'Scheduled backups & restore', 'UniFi camera auto check-in/out'] },
  };
  const [billing, setBilling] = useState(null); // flat /auth/me payload
  const [billingBusy, setBillingBusy] = useState(''); // 'pro' | 'enterprise' | 'portal' | ''
  const loadBilling = () => api.get('/auth/me').then(r => { setBilling(r.data); updateUser(r.data); }).catch(() => {});
  useEffect(() => {
    loadBilling();
    // Return from Stripe Checkout: confirm, refresh, and clean the URL
    const q = new URLSearchParams(window.location.search);
    const b = q.get('billing');
    if (b === 'success') {
      const planLabel = q.get('plan') === 'enterprise' ? 'Enterprise' : 'Pro';
      toast(`Welcome to ${planLabel}! Your subscription is active — new features unlock immediately.`);
      loadBilling();
    } else if (b === 'cancelled') {
      toast('Checkout cancelled — nothing was charged', 'info');
    }
    if (b) {
      q.delete('billing'); q.delete('plan');
      const qs = q.toString();
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCheckout = async (plan) => {
    setBillingBusy(plan);
    try {
      const r = await api.post('/billing/checkout', { plan });
      window.location.href = r.data.url; // → Stripe Checkout
    } catch (err) {
      const d = err.response?.data;
      if (err.response?.status === 409 && d?.portal) {
        toast(d.error, 'info');
        openPortal();
      } else {
        toast(d?.error || 'Could not start checkout', 'error');
      }
      setBillingBusy('');
    }
  };
  const openPortal = async () => {
    setBillingBusy('portal');
    try {
      const r = await api.post('/billing/portal');
      window.location.href = r.data.url; // → Stripe customer portal
    } catch (err) {
      toast(err.response?.data?.error || 'Could not open billing management', 'error');
      setBillingBusy('');
    }
  };

  // ── Enterprise features: Backups + UniFi Protect ──
  const planFeatures = billing?.features || user?.features || [];
  const hasBackups = planFeatures.includes('backups');
  const hasUnifi = planFeatures.includes('unifi');
  const [backupBusy, setBackupBusy] = useState(false);
  const [unifiCfg, setUnifiCfg] = useState(null);
  const [unifiEvents, setUnifiEvents] = useState([]);
  const [unifiBusy, setUnifiBusy] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);

  const loadBackups = () => api.get('/backups')
    .then(r => { setBackups(r.data); setBackupsErr(null); })
    .catch(e => setBackupsErr(e.response?.data?.error || 'Could not load backups'));
  const loadUnifi = () => {
    api.get('/integrations/unifi/config').then(r => setUnifiCfg(r.data)).catch(() => {});
    api.get('/integrations/unifi/events').then(r => setUnifiEvents(r.data)).catch(() => {});
  };
  useEffect(() => { if (hasBackups) loadBackups(); }, [billing]);
  useEffect(() => { if (hasUnifi) loadUnifi(); }, [billing]);
  // eslint-disable-next-line react-hooks/exhaustive-deps

  const backupNow = async () => {
    setBackupBusy(true);
    try {
      await api.post('/backups');
      toast('Backup created — it appears in the list below');
      loadBackups();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to create backup', 'error');
    } finally { setBackupBusy(false); }
  };
  const saveBackupSchedule = async (v) => {
    try {
      await api.put('/backups/schedule', { schedule: v });
      setSettings(prev => ({ ...prev, backup_schedule: v }));
      toast(v === 'off' ? 'Automatic backups paused' : `Automatic backups: ${v}${v === 'weekly' ? ' (Sundays)' : ''}`);
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to save schedule', 'error');
    }
  };
  const saveUnifi = async (enabled, cameras) => {
    setUnifiBusy(true);
    try {
      const r = await api.put('/integrations/unifi/config', { enabled, cameras });
      setUnifiCfg(r.data);
      toast(enabled ? 'UniFi auto check-in is ON — paste the webhook URL into your UniFi console' : 'UniFi auto check-in is OFF');
      loadUnifi();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to save UniFi settings', 'error');
    } finally { setUnifiBusy(false); }
  };
  const rotateUnifiSecret = async () => {
    setUnifiBusy(true);
    try {
      const r = await api.post('/integrations/unifi/config/regenerate-secret');
      setUnifiCfg(r.data);
      setConfirmRotate(false);
      toast('New webhook URL generated — update it in your UniFi console');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to rotate', 'error');
    } finally { setUnifiBusy(false); }
  };


  const [notifyOffline, setNotifyOffline] = useState(false);

  // Org settings blob + unsaved-changes tracking
  const [settings, setSettings] = useState(() => DEFAULTS(org?.name));
  const savedSnapshot = useRef(JSON.stringify(DEFAULTS(org?.name)));
  const dirty = JSON.stringify(settings) !== savedSnapshot.current;
  const logoInputRef = useRef(null);

  // MFA
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaSetup, setMfaSetup] = useState(null); // { secret, qr }
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaDisableCode, setMfaDisableCode] = useState('');

  // Test SMS + custom registration fields editor
  const [testPhone, setTestPhone] = useState('');
  const [teamsBusy, setTeamsBusy] = useState(false);
  const [smsBusy, setSmsBusy] = useState(false);
  const [hookBusy, setHookBusy] = useState(false);
  const [apiKeys, setApiKeys] = useState([]);
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [freshKey, setFreshKey] = useState(null); // full plaintext key — shown once
  const [keyBusy, setKeyBusy] = useState(false);
  const [newField, setNewField] = useState({ label: '', type: 'text', required: false, options: '' });
  const [editingFieldIdx, setEditingFieldIdx] = useState(null); // which custom field is loaded in the editor
  // Visitor types manager (the "I am a..." buttons on the kiosk)
  const [visitorTypes, setVisitorTypes] = useState([]);
  const [vtForm, setVtForm] = useState({ name: '', description: '', badge_color: '#0D7377', requires_nda: false });
  const [vtEditingId, setVtEditingId] = useState(null);
  const [vtBusy, setVtBusy] = useState(false);

  const loadVisitorTypes = () => api.get('/visitor-types').then(r => setVisitorTypes(r.data || [])).catch(() => {});

  const saveVisitorType = async () => {
    if (!vtForm.name.trim()) return toast('Give the type a name first', 'error');
    setVtBusy(true);
    try {
      const payload = { name: vtForm.name.trim(), description: vtForm.description.trim(), badge_color: vtForm.badge_color, requires_nda: vtForm.requires_nda };
      if (vtEditingId) {
        await api.put(`/visitor-types/${vtEditingId}`, payload);
        toast('Visitor type updated');
      } else {
        await api.post('/visitor-types', payload);
        toast(`"${payload.name}" added — the kiosk picks it up within a minute`);
      }
      setVtForm({ name: '', description: '', badge_color: '#0D7377', requires_nda: false });
      setVtEditingId(null);
      loadVisitorTypes();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to save visitor type', 'error');
    } finally {
      setVtBusy(false);
    }
  };

  const deleteVisitorType = async (t) => {
    setVtBusy(true);
    try {
      await api.delete(`/visitor-types/${t.id}`);
      if (vtEditingId === t.id) { setVtEditingId(null); setVtForm({ name: '', description: '', badge_color: '#0D7377', requires_nda: false }); }
      loadVisitorTypes();
      toast(`"${t.name}" removed — past visits keep their records`);
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to delete', 'error');
    } finally {
      setVtBusy(false);
    }
  };

  const seedSuggestedTypes = async () => {
    const suggested = getTerms(settings.profile_type).defaultTypes || [];
    if (suggested.length === 0) return;
    setVtBusy(true);
    try {
      for (const t of suggested) {
        await api.post('/visitor-types', { name: t.name, badge_color: t.color });
      }
      loadVisitorTypes();
      toast('Suggested types added — edit them however you like');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to add suggested types', 'error');
    } finally {
      setVtBusy(false);
    }
  };

  // Daily backups (plan feature)
  const [backups, setBackups] = useState([]);
  const [backupsErr, setBackupsErr] = useState(null);
  // Self-restore flow: pick a snapshot, type RESTORE, everything is replaced
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [restoreText, setRestoreText] = useState('');
  const [restoreBusy, setRestoreBusy] = useState(false);

  useEffect(() => {
    if ((user?.features || []).includes('backups')) {
      api.get('/backups')
        .then(r => setBackups(r.data))
        .catch(e => setBackupsErr(e.response?.data?.error || 'Could not load backups'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const downloadBackup = async (id) => {
    try {
      const r = await api.get(`/backups/${id}/download`, { responseType: 'blob' });
      const dispo = r.headers['content-disposition'] || '';
      const name = (dispo.match(/filename="([^"]+)"/) || [])[1] || `backup-${id}.json`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(r.data);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast('Failed to download backup', 'error');
    }
  };

  const restoreBackup = async () => {
    if (!restoreTarget || restoreText !== 'RESTORE') return;
    setRestoreBusy(true);
    try {
      await api.post(`/backups/${restoreTarget.id}/restore`);
      toast('Backup restored — reloading…');
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      toast(e.response?.data?.error || 'Restore failed', 'error');
      setRestoreBusy(false);
      setRestoreTarget(null);
      setRestoreText('');
    }
  };

  const sendTestSms = async () => {
    if (!testPhone.trim()) return toast('Enter a phone number first', 'error');
    setSmsBusy(true);
    try {
      const r = await api.post('/settings/test-sms', { phone: testPhone.trim() });
      r.data.ok ? toast(r.data.message) : toast(r.data.message || 'SMS not sent', 'error');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to send test SMS', 'error');
    } finally {
      setSmsBusy(false);
    }
  };

  // Logo upload: read file, downscale to max 256px, store as data URL in the settings blob
  const handleLogoFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 256;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const out = file.type === 'image/png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85);
        setSettings(s => ({ ...s, logo_data: out }));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const startMfaSetup = async () => {
    setMfaBusy(true);
    try {
      const res = await api.post('/auth/mfa/setup');
      setMfaSetup(res.data);
      setMfaCode('');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to start MFA setup', 'error');
    } finally {
      setMfaBusy(false);
    }
  };

  const enableMfa = async () => {
    if (!mfaCode) return toast('Enter the 6-digit code from your authenticator app', 'error');
    setMfaBusy(true);
    try {
      await api.post('/auth/mfa/enable', { code: mfaCode });
      setMfaEnabled(true);
      setMfaSetup(null);
      setMfaCode('');
      toast('MFA enabled — you will need your code at next login');
    } catch (err) {
      toast(err.response?.data?.error || 'Invalid code', 'error');
    } finally {
      setMfaBusy(false);
    }
  };

  const disableMfa = async () => {
    if (!mfaDisableCode.trim()) return toast('Enter your current 6-digit code to disable MFA', 'error');
    setMfaBusy(true);
    try {
      await api.post('/auth/mfa/disable', { code: mfaDisableCode.trim() });
      setMfaEnabled(false);
      setMfaDisableCode('');
      toast('MFA disabled — your account is protected by password only');
    } catch (err) {
      toast(err.response?.data?.error || 'Invalid code', 'error');
    } finally {
      setMfaBusy(false);
    }
  };

  const toggleOfflineAlerts = async (value) => {
    setNotifyOffline(value);
    try {
      await api.patch('/auth/me/preferences', { notify_offline: value });
    } catch (err) {
      setNotifyOffline(!value); // revert on failure
      toast(err.response?.data?.error || 'Failed to save preference', 'error');
    }
  };

  useEffect(() => {
    api.get('/auth/me').then(r => { setNotifyOffline(!!r.data.notify_offline); setMfaEnabled(!!r.data.mfa_enabled); }).catch(() => {});
    api.get('/settings').then(r => {
      if (r.data && Object.keys(r.data).length > 0) {
        const merged = { ...DEFAULTS(org?.name), ...r.data };
        setSettings(merged);
        savedSnapshot.current = JSON.stringify(merged);
      }
    }).catch(() => {});
    api.get('/api-keys').then(r => setApiKeys(r.data || [])).catch(() => {});
    loadVisitorTypes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch('/settings', settings);
      savedSnapshot.current = JSON.stringify(settings); // no longer dirty
      // Profile type drives terminology across the app — refresh the session copy
      try {
        const me = await api.get('/auth/me');
        const { token, setAuth } = useStore.getState();
        setAuth(token, me.data, { id: me.data.org_id, name: me.data.org_name });
      } catch (_) { /* labels update on next login/refresh */ }
      toast('Settings saved');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const sectionStyle = {
    background: '#fff', borderRadius: 16, padding: 24,
    marginBottom: 24, boxShadow: '0 2px 10px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0'
  };

  const labelStyle = { display: 'block', fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 8 };
  const inputStyle = {
    width: '100%', padding: '12px 16px', borderRadius: 10,
    border: '2px solid #E2E8F0', fontSize: 14, outline: 'none'
  };

  return (
    <div>
      <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0F172A', marginBottom: 24 }}>Settings</h1>

      {/* Billing & Plan — Stripe subscriptions. Paying is a choice: an org whose
          subscription lapses keeps its kiosk/check-ins (limited mode) instead of
          being locked out, and management access returns when billing is resolved. */}
      <div style={sectionStyle}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <CreditCard size={20} color="#0D7377" /> Billing &amp; Plan
        </h3>
        {(() => {
          // Wait for /auth/me before choosing what to show — rendering the trial
          // view first and swapping a second later made paid sections "disappear".
          if (!billing) {
            return <div style={{ fontSize: 13, color: '#94A3B8', padding: '8px 0' }}>Loading billing…</div>;
          }
          // Unknown/legacy plan values degrade to the trial view so the upgrade
          // cards can never vanish because of an unexpected plan string.
          const planKey = BILLING_PLANS[billing.org_plan] ? billing.org_plan : 'free';
          const plan = BILLING_PLANS[planKey];
          const comped = billing.complimentary === true;
          const trialEnd = billing.trial_ends_at ? new Date(billing.trial_ends_at) : null;
          const trialActive = planKey === 'free' && trialEnd && trialEnd >= new Date();
          const renews = billing.plan_renews_at ? new Date(billing.plan_renews_at) : null;
          const limited = billing.billing_limited === true;

          // Complimentary orgs (owner, partners): full access, never billed —
          // no checkout, no portal, no trial countdown.
          if (comped) {
            return (
              <div style={{ padding: '16px 18px', borderRadius: 12, background: '#F0FDFA', border: '1px solid #99F6E4' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 17, fontWeight: 800, color: '#0D7377' }}>Owner account</span>
                  <span style={{ fontSize: 13, color: '#0F766E' }}>full access — never billed</span>
                </div>
                <div style={{ fontSize: 12.5, color: '#0F766E', marginTop: 6, lineHeight: 1.6 }}>
                  This organization belongs to the platform owner: every feature of the {plan.label} plan is unlocked
                  and no invoice will ever be generated. Managed from Super Admin → organization → Complimentary.
                </div>
              </div>
            );
          }
          return (
            <div>
              {/* current plan */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', borderRadius: 12, background: '#F8FAFC', border: '1px solid #E2E8F0', marginBottom: 14, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 17, fontWeight: 800, color: plan.color }}>{plan.label}</span>
                    <span style={{ fontSize: 13, color: '#64748B' }}>{plan.price > 0 ? `$${plan.price}/month` : 'no charge during trial'}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: '#64748B', marginTop: 4 }}>
                    {plan.perks.join(' · ')}
                  </div>
                  {trialActive && (
                    <div style={{ fontSize: 12.5, color: '#B45309', marginTop: 6, fontWeight: 600 }}>
                      Free trial ends {trialEnd.toLocaleDateString()} — subscribe now and billing only starts when the trial ends.
                    </div>
                  )}
                  {planKey === 'free' && !trialActive && (
                    <div style={{ fontSize: 12.5, color: '#B45309', marginTop: 6, fontWeight: 600 }}>
                      {trialEnd
                        ? `Trial ended ${trialEnd.toLocaleDateString()} — pick a plan below to unlock management features.`
                        : 'Pick a plan below to unlock management features.'}
                    </div>
                  )}
                  {planKey !== 'free' && renews && !limited && (
                    <div style={{ fontSize: 12.5, color: '#64748B', marginTop: 6 }}>
                      Renews {renews.toLocaleDateString()}
                    </div>
                  )}
                </div>
                {canManage && planKey !== 'free' && (
                  <button onClick={openPortal} disabled={billingBusy === 'portal'}
                    style={{ padding: '11px 20px', borderRadius: 10, background: '#fff', border: '2px solid #E2E8F0', color: '#334155', fontWeight: 700, fontSize: 13, cursor: billingBusy === 'portal' ? 'wait' : 'pointer', opacity: billingBusy === 'portal' ? 0.7 : 1 }}>
                    {billingBusy === 'portal' ? 'Opening…' : 'Manage billing (card, invoices, cancel)'}
                  </button>
                )}
              </div>

              {limited && (
                <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 12, padding: '12px 16px', marginBottom: 14, fontSize: 13, color: '#92400E', lineHeight: 1.55 }}>
                  <strong>Payment needed — you're in limited mode.</strong> Your kiosk, check-ins and visitor data keep working,
                  but management changes are paused until billing is resolved. Subscribe below (or update the card in Manage
                  billing) and everything unlocks immediately.
                </div>
              )}

              {/* upgrade cards — shown to trialing orgs and to lapsed subscribers re-subscribing */}
              {canManage && (planKey === 'free' || limited) && (
                <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
                  {['pro', 'enterprise'].map(k => {
                    const p = BILLING_PLANS[k];
                    const current = k === planKey;
                    return (
                      <div key={k} style={{ border: `2px solid ${k === 'pro' ? '#99F6E4' : '#FED7AA'}`, borderRadius: 14, padding: '16px 18px', background: k === 'pro' ? '#F0FDFA' : '#FFF7ED' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <span style={{ fontWeight: 800, fontSize: 16, color: p.color }}>{p.label}</span>
                          <span style={{ fontWeight: 800, fontSize: 15, color: '#0F172A' }}>${p.price}<span style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>/mo</span></span>
                        </div>
                        <div style={{ fontSize: 12.5, color: '#475569', margin: '8px 0 12px', lineHeight: 1.6 }}>
                          {p.perks.map(perk => (
                            <div key={perk} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <CheckCircle2 size={13} color={p.color} style={{ flexShrink: 0 }} /> {perk}
                            </div>
                          ))}
                        </div>
                        <button onClick={() => startCheckout(k)} disabled={!!billingBusy || current}
                          style={{
                            width: '100%', padding: '11px 16px', borderRadius: 10, border: 'none',
                            background: current ? '#E2E8F0' : p.color, color: current ? '#94A3B8' : '#fff',
                            fontWeight: 700, fontSize: 13, cursor: (billingBusy || current) ? 'not-allowed' : 'pointer'
                          }}>
                          {current ? 'Current plan' : billingBusy === k ? 'Opening Stripe…' : (limited && renews ? `Re-subscribe — ${p.label}` : `Subscribe — ${p.label}`)}
                        </button>
                      </div>
                    );
                  })}
                </div>
                <p style={{ fontSize: 12, color: '#94A3B8', margin: '10px 0 0' }}>
                  All plans start with a 14-day free trial — nothing is charged until the trial ends. After the trial the
                  kiosk and visitor log keep working while you decide; management features unlock the moment you subscribe.
                </p>
                </div>
              )}
              {canManage && planKey !== 'free' && !limited && (
                <p style={{ fontSize: 12, color: '#94A3B8', margin: 0 }}>
                  To switch between Pro and Enterprise, use Manage billing — plan changes prorate automatically.
                </p>
              )}
              {!canManage && (
                <p style={{ fontSize: 13, color: '#94A3B8', margin: 0 }}>Only admins can change billing.</p>
              )}
            </div>
          );
        })()}
      </div>

      {/* UniFi Protect — enterprise: camera face events drive check-in/out */}
      {canManage && hasUnifi && (
        <div style={sectionStyle}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
            <ScanFace size={20} color="#0D7377" /> UniFi Protect — camera auto check-in/out
          </h3>
          <p style={{ fontSize: 13, color: '#64748B', marginTop: 0, marginBottom: 16, lineHeight: 1.6 }}>
            Door cameras with face recognition sign people in and out automatically: a recognized host or a
            pre-registered visitor expected today is checked in when the camera sees them, and checked out when
            they leave. Unrecognized faces are logged below so nothing passes the door unnoticed.
            Requires UniFi Protect smart detections; automatic sign-in needs Known Faces (AI-capable camera, AI Port or AI Key)
            enrolled with the same names used in Sentinels Kiosk.
          </p>
          {unifiCfg === null ? (
            <div style={{ fontSize: 13, color: '#94A3B8' }}>Loading integration…</div>
          ) : (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 14 }}>
                <input type="checkbox" checked={unifiCfg.enabled === true}
                  onChange={(e) => saveUnifi(e.target.checked, unifiCfg.cameras || [])}
                  style={{ width: 20, height: 20 }} />
                <span style={{ fontSize: 14, fontWeight: 700, color: unifiCfg.enabled ? '#0F766E' : '#334155' }}>
                  Camera auto check-in/out is {unifiCfg.enabled ? 'ON' : 'OFF'}
                </span>
              </label>

              {unifiCfg.enabled && (
                <>
                  <div style={{ background: '#F0FDFA', border: '1px solid #99F6E4', borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0F766E', marginBottom: 6 }}>
                      1 · Paste this webhook URL into your UniFi console
                    </div>
                    <div style={{ fontSize: 12.5, color: '#134E4A', lineHeight: 1.7, marginBottom: 8 }}>
                      UniFi console → <strong>Protect → Settings → System → Webhooks</strong> (or an Alarm rule on your door
                      cameras) → add a webhook for <strong>smart detection / face events</strong> with this URL:
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <code style={{ flex: 1, minWidth: 240, fontSize: 11.5, background: '#fff', border: '1px solid #99F6E4', padding: '8px 10px', borderRadius: 8, wordBreak: 'break-all' }}>
                        {unifiCfg.webhook_url}
                      </code>
                      <button onClick={() => { navigator.clipboard.writeText(unifiCfg.webhook_url); toast('Webhook URL copied'); }}
                        style={{ padding: '8px 14px', borderRadius: 8, background: '#0D7377', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                        Copy
                      </button>
                      {confirmRotate ? (
                        <>
                          <span style={{ fontSize: 12, color: '#991B1B', fontWeight: 600 }}>Old URL stops working — continue?</span>
                          <button onClick={rotateUnifiSecret} disabled={unifiBusy}
                            style={{ padding: '8px 12px', borderRadius: 8, background: '#DC2626', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Yes, rotate</button>
                          <button onClick={() => setConfirmRotate(false)}
                            style={{ padding: '8px 12px', borderRadius: 8, background: '#F1F5F9', border: 'none', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                        </>
                      ) : (
                        <button onClick={() => setConfirmRotate(true)} title="Generate a new secret URL (the old one stops working)"
                          style={{ padding: '8px 14px', borderRadius: 8, background: '#fff', border: '1px solid #E2E8F0', fontSize: 12, fontWeight: 700, color: '#64748B', cursor: 'pointer' }}>
                          Rotate URL
                        </button>
                      )}
                    </div>
                    <div style={{ fontSize: 12.5, color: '#134E4A', lineHeight: 1.7, marginTop: 10 }}>
                      2 · Enroll your people: in Protect, add each host and frequent visitor to <strong>Known Faces</strong>
                      with exactly the same first and last name they have in Sentinels Kiosk. Pre-registered visitors are
                      matched by name on their visit day.
                    </div>
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 8 }}>
                      3 · Camera directions <span style={{ fontWeight: 500, color: '#94A3B8' }}>(optional — unmapped cameras toggle in/out automatically)</span>
                    </div>
                    {(unifiCfg.cameras || []).map((c, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input type="text" value={c.name} placeholder="Camera name exactly as in Protect (e.g. Front Door)"
                          onChange={(e) => { const cs = [...unifiCfg.cameras]; cs[i] = { ...cs[i], name: e.target.value }; setUnifiCfg({ ...unifiCfg, cameras: cs }); }}
                          style={{ flex: 1, minWidth: 220, padding: '10px 12px', borderRadius: 8, border: '2px solid #E2E8F0', fontSize: 13 }} />
                        <select value={c.direction}
                          onChange={(e) => { const cs = [...unifiCfg.cameras]; cs[i] = { ...cs[i], direction: e.target.value }; setUnifiCfg({ ...unifiCfg, cameras: cs }); }}
                          style={{ padding: '10px 12px', borderRadius: 8, border: '2px solid #E2E8F0', fontSize: 13, background: '#fff' }}>
                          <option value="both">Door (in &amp; out)</option>
                          <option value="in">Entrance only</option>
                          <option value="out">Exit only</option>
                        </select>
                        <button onClick={() => { const cs = unifiCfg.cameras.filter((_, j) => j !== i); setUnifiCfg({ ...unifiCfg, cameras: cs }); }}
                          style={{ padding: '9px 12px', borderRadius: 8, background: '#FEF2F2', border: 'none', cursor: 'pointer' }}>
                          <Trash2 size={14} color="#EF4444" />
                        </button>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => setUnifiCfg({ ...unifiCfg, cameras: [...(unifiCfg.cameras || []), { name: '', direction: 'both' }] })}
                        style={{ padding: '9px 14px', borderRadius: 8, background: '#F1F5F9', border: 'none', fontSize: 12, fontWeight: 700, color: '#334155', cursor: 'pointer' }}>
                        <Plus size={13} style={{ verticalAlign: -2 }} /> Add camera
                      </button>
                      <button onClick={() => saveUnifi(true, unifiCfg.cameras || [])} disabled={unifiBusy}
                        style={{ padding: '9px 14px', borderRadius: 8, background: '#0D7377', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: unifiBusy ? 'wait' : 'pointer' }}>
                        {unifiBusy ? 'Saving…' : 'Save cameras'}
                      </button>
                    </div>
                  </div>
                </>
              )}

              <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 8 }}>Recent door events</div>
              {unifiEvents.length === 0 ? (
                <div style={{ fontSize: 13, color: '#94A3B8', background: '#F8FAFC', borderRadius: 10, padding: '14px 16px' }}>
                  No events yet — they appear here the moment a camera reports a person.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                  {unifiEvents.map(ev => (
                    <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: '#F8FAFC', fontSize: 12.5, flexWrap: 'wrap' }}>
                      <span style={{
                        fontWeight: 800, padding: '2px 10px', borderRadius: 12, fontSize: 11, textTransform: 'uppercase',
                        background: ev.action === 'checked_in' ? '#DCFCE7' : ev.action === 'checked_out' ? '#EFF6FF' : ev.action === 'unidentified' ? '#FEF2F2' : '#F1F5F9',
                        color: ev.action === 'checked_in' ? '#166534' : ev.action === 'checked_out' ? '#1D4ED8' : ev.action === 'unidentified' ? '#991B1B' : '#64748B'
                      }}>{ev.action.replace('_', ' ')}</span>
                      <span style={{ fontWeight: 700, color: '#0F172A' }}>{ev.person_name || 'Unknown person'}</span>
                      <span style={{ color: '#64748B' }}>{ev.camera || 'camera'}</span>
                      <span style={{ marginLeft: 'auto', color: '#94A3B8' }}>{new Date(ev.created_at).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Branding */}
      <div style={sectionStyle}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Palette size={20} color="#0D7377" /> Branding
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelStyle}>Organization Name</label>
            <input type="text" value={settings.org_name}
              onChange={(e) => setSettings({...settings, org_name: e.target.value})}
              style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Organization Profile</label>
            <select value={settings.profile_type || 'other'}
              onChange={(e) => setSettings({...settings, profile_type: e.target.value})}
              style={{ ...inputStyle, background: '#fff' }}>
              {PROFILE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <p style={{ fontSize: 12, color: '#64748B', marginTop: 6 }}>
              Menus and labels adapt to your organization: a building manages <strong>tenants</strong>, a business <strong>employees</strong>, a hospital <strong>doctors &amp; staff</strong>.
              {settings.profile_type && settings.profile_type !== 'other' && (
                <> Currently shown as: <strong>{getTerms(settings.profile_type).hosts}</strong>.</>
              )}
            </p>
          </div>
          <div>
            <label style={labelStyle}>Logo</label>
            <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoFile} style={{ display: 'none' }} />
            {settings.logo_data ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <img src={settings.logo_data} alt="Organization logo"
                  style={{ width: 120, height: 120, objectFit: 'contain', borderRadius: 16, border: '1px solid #E2E8F0', background: '#fff', padding: 8 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button type="button" onClick={() => logoInputRef.current?.click()}
                    style={{ padding: '9px 16px', borderRadius: 10, background: '#F1F5F9', border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', color: '#334155' }}>
                    Replace logo
                  </button>
                  <button type="button" onClick={() => setSettings({ ...settings, logo_data: '' })}
                    style={{ padding: '9px 16px', borderRadius: 10, background: '#FEF2F2', border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', color: '#991B1B', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <X size={14} /> Remove
                  </button>
                </div>
              </div>
            ) : (
              <div onClick={() => logoInputRef.current?.click()} style={{
                width: 120, height: 120, borderRadius: 16, border: '2px dashed #E2E8F0',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                color: '#64748B', cursor: 'pointer', gap: 8
              }}>
                <Upload size={24} />
                <span style={{ fontSize: 12 }}>Upload logo</span>
              </div>
            )}
            <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 8 }}>
              Shown on the kiosk welcome screen. Any image works — it's resized automatically. Save Settings to apply.
            </div>
          </div>
          <div>
            <label style={labelStyle}>Badge label</label>
            <input type="text" value={settings.badge_label || ''} placeholder="EMPLOYEE BADGE"
              onChange={(e) => setSettings({...settings, badge_label: e.target.value})}
              style={inputStyle} />
            <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 6 }}>
              What you call the people who receive visitors — printed at the top of their ID badges.
              Examples: "Sentinels Employee", "Tenant — Building 1". Leave empty for "EMPLOYEE BADGE".
            </div>
          </div>
          <div>
            <label style={labelStyle}>Overstay warning (hours)</label>
            <input type="number" min="1" max="72" value={settings.overstay_hours ?? 8}
              onChange={(e) => setSettings({...settings, overstay_hours: e.target.value === '' ? '' : Number(e.target.value)})}
              style={{ ...inputStyle, maxWidth: 140 }} />
            <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 6 }}>
              The dashboard flags visitors who have been signed in longer than this many hours.
            </div>
          </div>
          <div>
            <label style={labelStyle}>Theme palette</label>
            <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 10 }}>
              One click recolors the whole kiosk (welcome, sign-in, sign-out screens). Fine-tune with the custom pickers below. Kiosks pick up changes within 5 minutes — remember Save Settings.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
              {THEME_PALETTES.map(p => {
                const active = (settings.primary_color || '').toLowerCase() === p.primary.toLowerCase() && (settings.accent_color || '').toLowerCase() === p.accent.toLowerCase();
                return (
                  <button type="button" key={p.name}
                    onClick={() => setSettings({ ...settings, primary_color: p.primary, accent_color: p.accent })}
                    style={{
                      textAlign: 'left', padding: '12px 14px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
                      border: active ? '2px solid #0D7377' : '2px solid #E2E8F0',
                      background: active ? '#F0FDFA' : '#fff',
                      boxShadow: active ? '0 2px 8px rgba(13,115,119,0.15)' : 'none'
                    }}>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                      <span style={{ width: 26, height: 26, borderRadius: 8, background: p.primary, display: 'inline-block' }} />
                      <span style={{ width: 26, height: 26, borderRadius: 8, background: p.accent, display: 'inline-block' }} />
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: '#94A3B8' }}>{p.blurb}</div>
                    {active && <div style={{ fontSize: 11, fontWeight: 800, color: '#0F766E', marginTop: 4 }}>✓ Active</div>}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={labelStyle}>Primary Color</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <input type="color" value={settings.primary_color}
                  onChange={(e) => setSettings({...settings, primary_color: e.target.value})}
                  style={{ width: 50, height: 50, border: 'none', borderRadius: 10, cursor: 'pointer' }} />
                <span style={{ fontSize: 14, color: '#64748B', fontFamily: 'monospace' }}>{settings.primary_color}</span>
              </div>
            </div>
            <div>
              <label style={labelStyle}>Accent Color</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <input type="color" value={settings.accent_color}
                  onChange={(e) => setSettings({...settings, accent_color: e.target.value})}
                  style={{ width: 50, height: 50, border: 'none', borderRadius: 10, cursor: 'pointer' }} />
                <span style={{ fontSize: 14, color: '#64748B', fontFamily: 'monospace' }}>{settings.accent_color}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div style={sectionStyle}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Bell size={20} color="#0D7377" /> Notifications
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={settings.notify_email}
              onChange={(e) => setSettings({...settings, notify_email: e.target.checked})} />
            <div>
              <div style={{ fontWeight: 600, color: '#0F172A' }}>Email Notifications</div>
              <div style={{ fontSize: 13, color: '#64748B' }}>Send email to hosts when visitors arrive</div>
            </div>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={settings.notify_sms}
              onChange={(e) => setSettings({...settings, notify_sms: e.target.checked})} />
            <div>
              <div style={{ fontWeight: 600, color: '#0F172A' }}>SMS Notifications</div>
              <div style={{ fontSize: 13, color: '#64748B' }}>Send SMS to hosts when visitors arrive</div>
            </div>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', paddingTop: 12, borderTop: '1px solid #F1F5F9' }}>
            <input type="checkbox" checked={notifyOffline}
              onChange={(e) => toggleOfflineAlerts(e.target.checked)} />
            <div>
              <div style={{ fontWeight: 600, color: '#0F172A' }}>Kiosk Offline Alerts</div>
              <div style={{ fontSize: 13, color: '#64748B' }}>Email me if the kiosk stops responding (10+ min), and when it comes back online · <strong>this one saves immediately, no Save needed</strong></div>
            </div>
          </label>

          {/* Test SMS — verifies the Twilio env vars on Render actually work */}
          <div style={{ marginTop: 16, padding: 16, borderRadius: 12, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
            <div style={{ fontWeight: 600, color: '#0F172A', marginBottom: 4 }}>Test SMS</div>
            <div style={{ fontSize: 12, color: '#64748B', marginBottom: 10 }}>
              Verify your Twilio setup — sends one text from your Twilio number. Include the country code (e.g. +1347…).
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input type="tel" placeholder="+1…" value={testPhone} onChange={(e) => setTestPhone(e.target.value)}
                style={{ ...inputStyle, flex: 1, minWidth: 180 }} />
              <button type="button" onClick={sendTestSms} disabled={smsBusy}
                style={{ padding: '12px 20px', borderRadius: 10, background: '#0D7377', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
                {smsBusy ? 'Sending…' : 'Send Test SMS'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Front Desk & Integrations — check-in popup, ID scan, Teams */}
      <div style={sectionStyle}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          <ScanFace size={20} color="#0D7377" /> Front Desk &amp; Integrations
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={settings.checkin_popup !== false}
              onChange={(e) => setSettings({...settings, checkin_popup: e.target.checked})} />
            <div>
              <div style={{ fontWeight: 600, color: '#0F172A' }}>Check-in Alerts on the Dashboard</div>
              <div style={{ fontSize: 13, color: '#64748B' }}>
                Pop up each new arrival's photo and details on the dashboard as they check in — for a secretary, guard, or anyone watching the lobby.
                With multiple kiosks it shows <strong>which kiosk</strong> they used, so the front desk sees who came in at the door.
              </div>
            </div>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={settings.id_scan_enabled === true}
              onChange={(e) => setSettings({...settings, id_scan_enabled: e.target.checked})} />
            <div>
              <div style={{ fontWeight: 600, color: '#0F172A' }}>ID Scan at the Kiosk (OCR)</div>
              <div style={{ fontSize: 13, color: '#64748B' }}>
                Adds a "Scan ID" button to kiosk check-in: the visitor photographs their ID and the name, last name and date of birth
                are filled in automatically (they confirm before submitting). Useful for hospitals and clinics.
              </div>
            </div>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={settings.auto_print_badge === true}
              onChange={(e) => setSettings({...settings, auto_print_badge: e.target.checked})} />
            <div>
              <div style={{ fontWeight: 600, color: '#0F172A' }}>Auto-print Visitor Badges</div>
              <div style={{ fontSize: 13, color: '#64748B', lineHeight: 1.55 }}>
                Print the visitor's badge automatically right after kiosk check-in. <strong>Both switches are required:</strong>
                ① this org switch (then Save Settings), and ② <strong>Devices → Badge printing switch</strong> ON on each kiosk that should print.
                Badges print on that kiosk's own default printer — verify the chain any time with <strong>Devices → Test print</strong>
                (run it on the kiosk computer), and reprint any visitor from the kiosk's
                success screen or <strong>Visits → printer icon</strong>. For unattended kiosks, run the browser with silent printing
                (Chrome's <code>--kiosk-printing</code>) so no print dialog appears.
              </div>
            </div>
          </label>

          {/* Microsoft Teams notifications */}
          <div style={{ marginTop: 8, padding: 16, borderRadius: 12, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
            <div style={{ fontWeight: 600, color: '#0F172A', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Webhook size={16} color="#0D7377" /> Microsoft Teams Notifications
            </div>
            <div style={{ fontSize: 12, color: '#64748B', marginBottom: 10, lineHeight: 1.6 }}>
              Post every check-in (visitor, staff, frequent visitor) to a Teams channel. In Teams: channel → ⋯ → Connectors →
              <strong> Incoming Webhook</strong> → create and copy the URL here.
            </div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 }}>Teams Webhook URL</label>
            <input type="url" placeholder="https://…webhook.office.com/…" value={settings.teams_webhook_url || ''}
              onChange={(e) => setSettings({...settings, teams_webhook_url: e.target.value.trim()})}
              style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 13 }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginTop: 10 }}>
              <input type="checkbox" checked={settings.teams_notifications !== false}
                onChange={(e) => setSettings({...settings, teams_notifications: e.target.checked})}
                style={{ width: 20, height: 20 }} />
              <span style={{ fontSize: 13, color: '#334155', fontWeight: 600 }}>Send check-in cards to Teams</span>
            </label>
            <button type="button" disabled={teamsBusy || !settings.teams_webhook_url}
              onClick={async () => {
                setTeamsBusy(true);
                try {
                  await api.patch('/settings', settings);
                  savedSnapshot.current = JSON.stringify(settings);
                  await api.post('/settings/test-teams');
                  toast('Test message sent — check your Teams channel');
                } catch (err) {
                  toast(err.response?.data?.error || 'Teams test failed', 'error');
                } finally { setTeamsBusy(false); }
              }}
              style={{ marginTop: 12, padding: '10px 18px', borderRadius: 10, background: '#0D7377', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13, opacity: (!settings.teams_webhook_url) ? 0.5 : 1 }}>
              {teamsBusy ? 'Sending…' : 'Save & Send Test Message'}
            </button>
          </div>

          {/* Generic outbound webhook (Zapier / Make / custom endpoints) */}
          <div style={{ marginTop: 4, padding: 16, borderRadius: 12, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
            <div style={{ fontWeight: 600, color: '#0F172A', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Webhook size={16} color="#0D7377" /> Webhook (Zapier, Make, or your own endpoint)
            </div>
            <div style={{ fontSize: 12, color: '#64748B', marginBottom: 10, lineHeight: 1.6 }}>
              Every check-in also POSTs a JSON payload (<code>visitor.checkin</code>, <code>staff.checkin</code>, <code>frequent_visitor.checkin</code>)
              to this URL. In Zapier: create a Zap → <strong>Webhooks → Catch Hook</strong> → paste the URL here.
            </div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 }}>Webhook URL</label>
            <input type="url" placeholder="https://hooks.zapier.com/hooks/catch/…" value={settings.generic_webhook_url || ''}
              onChange={(e) => setSettings({...settings, generic_webhook_url: e.target.value.trim()})}
              style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 13 }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginTop: 10 }}>
              <input type="checkbox" checked={settings.generic_webhook_enabled !== false}
                onChange={(e) => setSettings({...settings, generic_webhook_enabled: e.target.checked})}
                style={{ width: 20, height: 20 }} />
              <span style={{ fontSize: 13, color: '#334155', fontWeight: 600 }}>Send check-in events to this webhook</span>
            </label>
            <button type="button" disabled={hookBusy || !settings.generic_webhook_url}
              onClick={async () => {
                setHookBusy(true);
                try {
                  await api.patch('/settings', settings);
                  savedSnapshot.current = JSON.stringify(settings);
                  await api.post('/settings/test-webhook');
                  toast('Test event sent — check your endpoint / Zap history');
                } catch (err) {
                  toast(err.response?.data?.error || 'Webhook test failed', 'error');
                } finally { setHookBusy(false); }
              }}
              style={{ marginTop: 12, padding: '10px 18px', borderRadius: 10, background: '#0D7377', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13, opacity: (!settings.generic_webhook_url) ? 0.5 : 1 }}>
              {hookBusy ? 'Sending…' : 'Save & Send Test Event'}
            </button>
          </div>

          {/* API keys for custom integrations */}
          <div style={{ marginTop: 4, padding: 16, borderRadius: 12, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
            <div style={{ fontWeight: 600, color: '#0F172A', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <KeyRound size={16} color="#0D7377" /> API Keys
            </div>
            <div style={{ fontSize: 12, color: '#64748B', marginBottom: 10, lineHeight: 1.6 }}>
              Read your data from any system. Endpoints: <code>GET /api/visits</code>, <code>GET /api/visits/active</code>, <code>GET /api/hosts</code>
              with header <code>x-api-key: sk_live_…</code>. Example:
              <div style={{ fontFamily: 'monospace', fontSize: 11, background: '#0F172A', color: '#A7F3D0', padding: '8px 10px', borderRadius: 8, marginTop: 6, overflowX: 'auto' }}>
                curl -H "x-api-key: sk_live_…" https://api.sentinelskiosk.com/api/visits/active
              </div>
            </div>
            {freshKey && (
              <div style={{ marginBottom: 10, padding: 12, borderRadius: 10, background: '#FFFBEB', border: '2px solid #F59E0B' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#92400E', marginBottom: 4 }}>Copy this key now — it will never be shown again:</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <code style={{ flex: 1, fontSize: 12, background: '#fff', padding: '8px 10px', borderRadius: 8, wordBreak: 'break-all' }}>{freshKey}</code>
                  <button type="button" onClick={() => { navigator.clipboard?.writeText(freshKey); toast('Key copied'); }}
                    style={{ padding: '8px 14px', borderRadius: 8, background: '#D97706', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    Copy
                  </button>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input type="text" placeholder="Label, e.g. Access-control sync" value={newKeyLabel}
                onChange={(e) => setNewKeyLabel(e.target.value)}
                style={{ ...inputStyle, flex: '1 1 200px' }} />
              <button type="button" disabled={keyBusy}
                onClick={async () => {
                  setKeyBusy(true);
                  try {
                    const r = await api.post('/api-keys', { label: newKeyLabel || 'Integration key' });
                    setFreshKey(r.data.key);
                    setNewKeyLabel('');
                    setApiKeys(k => [r.data, ...k]);
                  } catch (err) {
                    toast(err.response?.data?.error || 'Failed to create key', 'error');
                  } finally { setKeyBusy(false); }
                }}
                style={{ padding: '10px 18px', borderRadius: 10, background: '#0D7377', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
                {keyBusy ? 'Creating…' : 'Generate Key'}
              </button>
            </div>
            {apiKeys.length > 0 && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {apiKeys.map(k => (
                  <div key={k.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 12px', background: '#fff', borderRadius: 8, border: '1px solid #E2E8F0', flexWrap: 'wrap' }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 13, color: '#0F172A' }}>{k.label}</span>
                      <span style={{ fontSize: 12, color: '#64748B', marginLeft: 8, fontFamily: 'monospace' }}>{k.key_prefix}…</span>
                      <div style={{ fontSize: 11, color: '#94A3B8' }}>
                        {k.is_active ? 'Active' : 'Revoked'}{k.last_used_at ? ` · last used ${new Date(k.last_used_at).toLocaleDateString()}` : ' · never used'}
                      </div>
                    </div>
                    {k.is_active && (
                      <button type="button" onClick={async () => {
                        try { await api.delete(`/api-keys/${k.id}`); setApiKeys(keys => keys.map(x => x.id === k.id ? { ...x, is_active: false } : x)); toast('Key revoked'); }
                        catch (err) { toast(err.response?.data?.error || 'Failed to revoke', 'error'); }
                      }}
                        style={{ padding: '6px 12px', borderRadius: 8, background: '#FEF2F2', border: 'none', color: '#991B1B', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Registration Form — custom fields per organization */}
      <div style={sectionStyle}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
          <PenLine size={20} color="#0D7377" /> Registration Form
        </h3>
        <p style={{ fontSize: 13, color: '#64748B', marginBottom: 16, lineHeight: 1.5 }}>
          Choose what the kiosk asks during check-in — hide standard fields you don't need and add
          your own (e.g. an apartment building asks "Apartment #", a school asks "Student ID").
          Answers are stored with each visit (Visits → eye icon). Remember to Save Settings after editing.
        </p>

        {/* Standard field visibility — name, host and visitor type are structural and always asked */}
        <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 8 }}>Standard fields on the kiosk</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8, marginBottom: 18 }}>
          {[
            { key: 'email', label: 'Email' },
            { key: 'phone', label: 'Phone' },
            { key: 'company', label: 'Company' },
            { key: 'purpose', label: 'Purpose of visit' },
            { key: 'vehicle_plate', label: 'Vehicle plate' },
            { key: 'photo', label: 'Photo capture' },
            { key: 'host', label: 'Host / person visiting' },
            { key: 'visitor_type', label: 'Visitor type' },
          ].map(({ key, label }) => {
            const shown = !(settings.hidden_fields || []).includes(key);
            return (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: shown ? '#F0FDFA' : '#F8FAFC', border: `1px solid ${shown ? '#99F6E4' : '#E2E8F0'}`, borderRadius: 10, fontSize: 13, fontWeight: 600, color: shown ? '#0F172A' : '#94A3B8', cursor: 'pointer' }}>
                <input type="checkbox" checked={shown}
                  onChange={(e) => {
                    const cur = settings.hidden_fields || [];
                    const next = e.target.checked ? cur.filter(k => k !== key) : [...cur, key];
                    setSettings({ ...settings, hidden_fields: next });
                  }} />
                {label}
              </label>
            );
          })}
          {/* Date of birth is opt-in rather than hide-on: on by default for the
              hospital profile, off for everyone else — and the ID scanner fills it */}
          {(() => {
            const shown = typeof settings.dob_enabled === 'boolean'
              ? settings.dob_enabled
              : settings.profile_type === 'hospital';
            return (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: shown ? '#F0FDFA' : '#F8FAFC', border: `1px solid ${shown ? '#99F6E4' : '#E2E8F0'}`, borderRadius: 10, fontSize: 13, fontWeight: 600, color: shown ? '#0F172A' : '#94A3B8', cursor: 'pointer' }}>
                <input type="checkbox" checked={shown}
                  onChange={(e) => setSettings({ ...settings, dob_enabled: e.target.checked })} />
                Date of birth
              </label>
            );
          })()}
        </div>
        <p style={{ fontSize: 12, color: '#94A3B8', marginTop: -8, marginBottom: 18 }}>
          Only first and last name are mandatory — every other field is yours to show or hide.
          Hiding <strong>Host</strong> means visitors aren't asked who they're visiting and no arrival
          notifications go out. Hiding <strong>Visitor type</strong> removes the type buttons.
          <strong>Date of birth</strong> starts on for hospitals and off for everyone else — the ID
          scanner (Settings → Front Desk &amp; Integrations) fills it automatically when it's shown.
          The kiosk picks changes up within 30 seconds.
        </p>

        <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 8 }}>Your own fields</div>
        {(settings.custom_fields || []).map((f, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: editingFieldIdx === i ? '#F0FDFA' : '#F8FAFC', border: `1px solid ${editingFieldIdx === i ? '#99F6E4' : 'transparent'}`, borderRadius: 10, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 600, fontSize: 14, color: '#0F172A' }}>{f.label}</span>
              <span style={{ fontSize: 12, color: '#64748B', marginLeft: 8 }}>
                {f.type}{f.required ? ' · required' : ''}{f.type === 'dropdown' ? ` · ${(f.options || []).join(', ')}` : ''}
              </span>
            </div>
            <button type="button" onClick={() => {
              setEditingFieldIdx(i);
              setNewField({ label: f.label, type: f.type, required: !!f.required, options: (f.options || []).join(', ') });
            }}
              style={{ padding: '6px 12px', borderRadius: 8, background: '#F0FDFA', border: '1px solid #99F6E4', color: '#0F766E', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Edit
            </button>
            <button type="button" onClick={() => {
              setSettings({ ...settings, custom_fields: settings.custom_fields.filter((_, j) => j !== i) });
              if (editingFieldIdx === i) { setEditingFieldIdx(null); setNewField({ label: '', type: 'text', required: false, options: '' }); }
            }}
              style={{ padding: '6px 12px', borderRadius: 8, background: '#FEF2F2', border: 'none', color: '#991B1B', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Remove
            </button>
          </div>
        ))}

        {editingFieldIdx !== null && (
          <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, background: '#F0FDFA', border: '1px solid #99F6E4', fontSize: 13, color: '#0F766E', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>Editing: {(settings.custom_fields || [])[editingFieldIdx]?.label}</span>
            <button type="button" onClick={() => { setEditingFieldIdx(null); setNewField({ label: '', type: 'text', required: false, options: '' }); }}
              style={{ padding: '4px 12px', borderRadius: 8, background: 'transparent', border: '1px solid #99F6E4', color: '#0F766E', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Cancel edit
            </button>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginTop: 12 }}>
          <input type="text" placeholder="Field label — e.g. Apartment #" value={newField.label}
            onChange={(e) => setNewField({ ...newField, label: e.target.value })} style={inputStyle} />
          <select value={newField.type} onChange={(e) => setNewField({ ...newField, type: e.target.value })} style={{ ...inputStyle, background: '#fff' }}>
            <option value="text">Text answer</option>
            <option value="dropdown">Dropdown (choices)</option>
            <option value="checkbox">Checkbox (yes/no)</option>
          </select>
        </div>
        {newField.type === 'dropdown' && (
          <input type="text" placeholder="Choices, comma separated — e.g. Building 1, Building 2, Building 3" value={newField.options}
            onChange={(e) => setNewField({ ...newField, options: e.target.value })} style={{ ...inputStyle, marginTop: 10 }} />
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, flexWrap: 'wrap', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#334155', cursor: 'pointer' }}>
            <input type="checkbox" checked={newField.required} onChange={(e) => setNewField({ ...newField, required: e.target.checked })} />
            Required (visitor can't continue without answering)
          </label>
          <button type="button" onClick={() => {
            if (!newField.label.trim()) return toast('Give the field a label first', 'error');
            const field = { label: newField.label.trim(), type: newField.type, required: newField.required };
            if (newField.type === 'dropdown') {
              field.options = newField.options.split(',').map(o => o.trim()).filter(Boolean);
              if (field.options.length === 0) return toast('Add at least one choice for the dropdown', 'error');
            }
            if (editingFieldIdx !== null) {
              // Update in place — keeps the field's position and its existing answers on past visits
              setSettings({ ...settings, custom_fields: (settings.custom_fields || []).map((cf, j) => j === editingFieldIdx ? field : cf) });
              setEditingFieldIdx(null);
            } else {
              setSettings({ ...settings, custom_fields: [...(settings.custom_fields || []), field] });
            }
            setNewField({ label: '', type: 'text', required: false, options: '' });
          }}
            style={{ padding: '10px 20px', borderRadius: 10, background: '#0D7377', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
            {editingFieldIdx !== null ? 'Save changes' : '+ Add Field'}
          </button>
        </div>
      </div>

      {/* Visitor Types — the "I am a..." buttons on the kiosk */}
      <div style={sectionStyle}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Users size={20} color="#0D7377" /> Visitor Types
        </h3>
        <p style={{ fontSize: 13, color: '#64748B', marginBottom: 16, lineHeight: 1.5 }}>
          The buttons visitors pick on the kiosk's first screen ("I am a…"). Make them fit your
          organization — a hospital might use <em>Patient, Family Member, Vendor</em>. Changes reach
          the kiosk within a minute; no Save Settings needed for this section.
        </p>

        {visitorTypes.length === 0 && (
          <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '12px 14px', marginBottom: 14, fontSize: 13, color: '#92400E', lineHeight: 1.5 }}>
            <strong>No types yet</strong> — the kiosk is showing generic suggestions for your industry.
            <button type="button" onClick={seedSuggestedTypes} disabled={vtBusy}
              style={{ marginLeft: 8, padding: '6px 14px', borderRadius: 8, background: '#0D7377', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              {vtBusy ? 'Adding…' : `Start with suggested ${getTerms(settings.profile_type).label} types`}
            </button>
            <div style={{ marginTop: 6, fontSize: 12 }}>
              {(getTerms(settings.profile_type).defaultTypes || []).map(t => t.name).join(' · ')} — they become fully editable once added.
            </div>
          </div>
        )}

        {visitorTypes.map(t => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: vtEditingId === t.id ? '#F0FDFA' : '#F8FAFC', border: `1px solid ${vtEditingId === t.id ? '#99F6E4' : 'transparent'}`, borderRadius: 10, marginBottom: 8 }}>
            <span style={{ width: 16, height: 16, borderRadius: '50%', background: t.badge_color, flexShrink: 0, border: '2px solid #fff', boxShadow: '0 0 0 1px #E2E8F0' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 600, fontSize: 14, color: '#0F172A' }}>{t.name}</span>
              <span style={{ fontSize: 12, color: '#64748B', marginLeft: 8 }}>
                {t.description || ''}{t.requires_nda ? ' · NDA required' : ''}
              </span>
            </div>
            <button type="button" onClick={() => { setVtEditingId(t.id); setVtForm({ name: t.name, description: t.description || '', badge_color: t.badge_color, requires_nda: !!t.requires_nda }); }}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, background: '#F0FDFA', border: '1px solid #99F6E4', color: '#0F766E', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              <Pencil size={12} /> Edit
            </button>
            <button type="button" onClick={() => deleteVisitorType(t)} disabled={vtBusy}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, background: '#FEF2F2', border: 'none', color: '#991B1B', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              <Trash2 size={12} /> Delete
            </button>
          </div>
        ))}

        {vtEditingId && (
          <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 10, background: '#F0FDFA', border: '1px solid #99F6E4', fontSize: 13, color: '#0F766E', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>Editing: {visitorTypes.find(t => t.id === vtEditingId)?.name}</span>
            <button type="button" onClick={() => { setVtEditingId(null); setVtForm({ name: '', description: '', badge_color: '#0D7377', requires_nda: false }); }}
              style={{ padding: '4px 12px', borderRadius: 8, background: 'transparent', border: '1px solid #99F6E4', color: '#0F766E', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Cancel edit
            </button>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
          <input type="text" placeholder="Type name — e.g. Patient" value={vtForm.name}
            onChange={(e) => setVtForm({ ...vtForm, name: e.target.value })} style={inputStyle} />
          <input type="text" placeholder="Description (optional)" value={vtForm.description}
            onChange={(e) => setVtForm({ ...vtForm, description: e.target.value })} style={inputStyle} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: '#334155', fontWeight: 600 }}>Button color:</span>
          {['#0D7377', '#FF6B35', '#2ECC71', '#9B59B6', '#D97706', '#2563EB', '#DC2626', '#475569'].map(c => (
            <button key={c} type="button" onClick={() => setVtForm({ ...vtForm, badge_color: c })}
              style={{ width: 26, height: 26, borderRadius: '50%', background: c, cursor: 'pointer', border: vtForm.badge_color === c ? '3px solid #0F172A' : '2px solid #fff', boxShadow: '0 0 0 1px #CBD5E1' }} />
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, flexWrap: 'wrap', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#334155', cursor: 'pointer' }}>
            <input type="checkbox" checked={vtForm.requires_nda} onChange={(e) => setVtForm({ ...vtForm, requires_nda: e.target.checked })} />
            Requires NDA signature
          </label>
          <button type="button" onClick={saveVisitorType} disabled={vtBusy}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px', borderRadius: 10, background: '#0D7377', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
            <Plus size={14} /> {vtBusy ? 'Saving…' : vtEditingId ? 'Save changes' : 'Add Type'}
          </button>
        </div>
      </div>

      {/* Security */}
      <div style={sectionStyle}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Shield size={20} color="#0D7377" /> Security
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={settings.require_photo}
              onChange={(e) => setSettings({...settings, require_photo: e.target.checked})} />
            <div>
              <div style={{ fontWeight: 600, color: '#0F172A' }}>Require Photo Capture</div>
              <div style={{ fontSize: 13, color: '#64748B' }}>Take a photo of every visitor during check-in</div>
            </div>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={settings.require_prereg_date || false}
              onChange={(e) => setSettings({...settings, require_prereg_date: e.target.checked})} />
            <div>
              <div style={{ fontWeight: 600, color: '#0F172A' }}>Require Date for Pre-Registrations</div>
              <div style={{ fontSize: 13, color: '#64748B' }}>Off by default — pre-registered visitors can have open-ended visits with no expected date/time</div>
            </div>
          </label>

          {/* ─── MFA ─── */}
          <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: 16, marginTop: 4 }}>
            <div style={{ fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>Two-Factor Authentication (MFA)</div>
            <div style={{ fontSize: 13, color: '#64748B', marginBottom: 12 }}>
              Status: <strong style={{ color: mfaEnabled ? '#166534' : '#92400E' }}>{mfaEnabled ? 'Enabled' : 'Disabled'}</strong>
              {' '}— protects your account with an authenticator app (Google Authenticator, Authy, 1Password...)
            </div>

            {!mfaEnabled && !mfaSetup && (
              <button onClick={startMfaSetup} disabled={mfaBusy}
                style={{ padding: '10px 20px', borderRadius: 10, background: '#0D7377', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
                {mfaBusy ? 'Preparing...' : 'Set Up MFA'}
              </button>
            )}

            {mfaSetup && (
              <div style={{ background: '#F8FAFC', borderRadius: 12, padding: 16, marginTop: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>1. Scan with your authenticator app:</div>
                <img src={mfaSetup.qr} alt="MFA QR" style={{ width: 180, height: 180, display: 'block', marginBottom: 8 }} />
                <div style={{ fontSize: 12, color: '#64748B', marginBottom: 12 }}>
                  Can't scan? Enter manually: <code style={{ background: '#fff', padding: '2px 8px', borderRadius: 6, border: '1px solid #E2E8F0' }}>{mfaSetup.secret}</code>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>2. Enter the 6-digit code:</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input type="text" inputMode="numeric" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} placeholder="123456"
                    style={{ padding: '12px 16px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 18, letterSpacing: 6, width: 160, textAlign: 'center' }} />
                  <button onClick={enableMfa} disabled={mfaBusy}
                    style={{ padding: '12px 20px', borderRadius: 10, background: '#166534', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                    Verify & Enable
                  </button>
                  <button onClick={() => { setMfaSetup(null); setMfaCode(''); }}
                    style={{ padding: '12px 16px', borderRadius: 10, background: '#F1F5F9', border: 'none', cursor: 'pointer' }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {mfaEnabled && (
              <div style={{ background: '#F8FAFC', borderRadius: 12, padding: 16, marginTop: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: '#0F172A' }}>Disable MFA</div>
                <div style={{ fontSize: 12, color: '#64748B', marginBottom: 10 }}>
                  Enter your current 6-digit authenticator code to confirm. Your account will be protected by password only.
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input type="text" inputMode="numeric" value={mfaDisableCode} onChange={(e) => setMfaDisableCode(e.target.value)} placeholder="123456"
                    style={{ padding: '12px 16px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 18, letterSpacing: 6, width: 160, textAlign: 'center' }} />
                  <button onClick={disableMfa} disabled={mfaBusy}
                    style={{ padding: '12px 20px', borderRadius: 10, background: '#FEF2F2', border: 'none', color: '#991B1B', fontWeight: 600, cursor: 'pointer' }}>
                    {mfaBusy ? 'Checking…' : 'Disable MFA'}
                  </button>
                </div>
              </div>
            )}

            {canManage && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', marginTop: 16, paddingTop: 12, borderTop: '1px solid #F1F5F9' }}>
                <input type="checkbox" checked={settings.mfa_required || false}
                  onChange={(e) => setSettings({...settings, mfa_required: e.target.checked})} />
                <div>
                  <div style={{ fontWeight: 600, color: '#0F172A' }}>Require MFA for everyone in this organization</div>
                  <div style={{ fontSize: 13, color: '#64748B' }}>Users without MFA will be sent to set it up at next login (remember to Save Settings below)</div>
                </div>
              </label>
            )}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={settings.require_nda}
              onChange={(e) => setSettings({...settings, require_nda: e.target.checked})} />
            <div>
              <div style={{ fontWeight: 600, color: '#0F172A' }}>Require NDA Signing</div>
              <div style={{ fontSize: 13, color: '#64748B' }}>Visitors must sign an NDA before entry</div>
            </div>
          </label>

          {settings.require_nda && (
            <div style={{ marginTop: 16, padding: 20, borderRadius: 12, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
              <div style={{ fontWeight: 600, color: '#0F172A', marginBottom: 6 }}>NDA Document</div>
              <div style={{ fontSize: 13, color: '#64748B', marginBottom: 12, lineHeight: 1.5 }}>
                This text is shown on the kiosk during check-in — for both walk-in visitors and
                pre-registered visitors scanning their QR code. The visitor signs with their finger
                on the kiosk screen and can't complete check-in without signing.
                Each signed copy (signature image + typed name + exact text signed + date/time) is
                stored with the visit — open <strong>Visits</strong> and click the NDA icon on any row to view it.
              </div>
              <textarea
                rows={10}
                value={settings.nda_text || ''}
                placeholder={'VISITOR NON-DISCLOSURE AGREEMENT\n\nBy signing below, the visitor agrees to keep confidential all non-public information, materials, and activities observed or accessed while on these premises.\n\nThe visitor agrees not to disclose, copy, photograph, record, or share any such information with any third party, and to follow all site safety and security rules for the duration of the visit.\n\nThis agreement takes effect upon signing and remains in effect after the visit ends.'}
                onChange={(e) => setSettings({...settings, nda_text: e.target.value})}
                style={{
                  width: '100%', padding: '12px 16px', borderRadius: 10,
                  border: '2px solid #E2E8F0', fontSize: 14, lineHeight: 1.6,
                  outline: 'none', resize: 'vertical', fontFamily: 'inherit'
                }}
              />
              <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 8 }}>
                Leave empty to use the default agreement shown above. Remember to click Save Settings.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Backups — included in the plan (Enterprise / add-on): scheduled + manual snapshots, download, restore */}
      {(user?.features || []).includes('backups') && (
        <div style={{
          background: '#fff', borderRadius: 16, padding: 24, marginBottom: 20,
          boxShadow: '0 2px 10px rgba(0,0,0,0.05)', border: '1px solid #E2E8F0'
        }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
            <HardDrive size={20} color="#0D7377" /> Backups
          </h3>
          <p style={{ fontSize: 13, color: '#64748B', marginBottom: 16, lineHeight: 1.5 }}>
            A full snapshot of your organization (users, hosts, visits, devices, settings) is taken automatically on the schedule below and kept for 30 days.
            You can also take one right now, download any snapshot for your records — or restore one if data is ever lost. A restore replaces ALL current data with the snapshot.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>Automatic backups</label>
              <select value={settings.backup_schedule || 'daily'} onChange={(e) => saveBackupSchedule(e.target.value)}
                style={{ padding: '10px 14px', borderRadius: 10, border: '2px solid #E2E8F0', fontSize: 13, background: '#fff' }}>
                <option value="daily">Daily (every night, 03:00 UTC)</option>
                <option value="weekly">Weekly (Sunday nights, 03:00 UTC)</option>
                <option value="off">Off — manual only</option>
              </select>
            </div>
            <button onClick={backupNow} disabled={backupBusy}
              style={{ padding: '10px 18px', borderRadius: 10, background: '#0D7377', border: 'none', color: '#fff', fontWeight: 700, fontSize: 13, cursor: backupBusy ? 'wait' : 'pointer', opacity: backupBusy ? 0.7 : 1 }}>
              {backupBusy ? 'Working…' : 'Back up now'}
            </button>
          </div>
          {backupsErr && (
            <div style={{ fontSize: 13, color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
              {backupsErr}
            </div>
          )}
          {backups.length === 0 && !backupsErr ? (
            <p style={{ fontSize: 13, color: '#94A3B8' }}>No snapshots yet — tap Back up now, or wait for the next scheduled run.</p>
          ) : (
            backups.slice(0, 10).map(b => (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 14px', background: '#F8FAFC', borderRadius: 10, marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: '#0F172A' }}>{new Date(b.created_at).toLocaleString()}</span>
                <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 12, background: b.kind === 'manual' ? '#EFF6FF' : '#F0FDFA', color: b.kind === 'manual' ? '#1D4ED8' : '#0F766E', textTransform: 'uppercase' }}>{b.kind}</span>
                <span style={{ fontSize: 12, color: '#64748B' }}>
                  {b.counts ? `${b.counts.users ?? 0} users, ${b.counts.hosts ?? 0} hosts, ${b.counts.visits ?? 0} visits` : ''}
                </span>
                <button onClick={() => downloadBackup(b.id)}
                  style={{ marginLeft: 'auto', padding: '7px 14px', borderRadius: 8, background: '#F0FDFA', border: '1px solid #5EEAD4', color: '#0F766E', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  Download
                </button>
                <button onClick={() => { setRestoreTarget(b); setRestoreText(''); }}
                  style={{ padding: '7px 14px', borderRadius: 8, background: '#FFF7ED', border: '1px solid #FDBA74', color: '#C2410C', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  Restore…
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Restore confirmation — type RESTORE to proceed */}
      {restoreTarget && (
        <div className="responsive-modal"
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div style={{ background: '#fff', borderRadius: 18, padding: 28, maxWidth: 480, width: '100%', boxShadow: '0 25px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: '#FEF2F2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AlertTriangle size={22} color="#DC2626" />
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 800, color: '#0F172A', margin: 0 }}>Restore this backup?</h3>
            </div>
            <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, marginBottom: 6 }}>
              Snapshot from <strong>{new Date(restoreTarget.created_at).toLocaleString()}</strong>.
            </p>
            <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, marginBottom: 16 }}>
              This <strong>permanently replaces all current data</strong> — users, hosts, visits, devices and settings — with the snapshot. Anything created after it was taken will be lost.
            </p>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#991B1B', display: 'block', marginBottom: 6 }}>
              Type RESTORE to confirm
            </label>
            <input type="text" value={restoreText} onChange={(e) => setRestoreText(e.target.value)}
              placeholder="RESTORE" autoFocus
              style={{ width: '100%', padding: '12px 16px', borderRadius: 10, border: '2px solid #FECACA', fontSize: 14, fontWeight: 700, letterSpacing: 2, marginBottom: 18 }} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => { setRestoreTarget(null); setRestoreText(''); }} disabled={restoreBusy}
                style={{ padding: '11px 22px', borderRadius: 10, background: '#F1F5F9', border: 'none', color: '#475569', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={restoreBackup} disabled={restoreText !== 'RESTORE' || restoreBusy}
                style={{ padding: '11px 22px', borderRadius: 10, background: restoreText === 'RESTORE' && !restoreBusy ? '#DC2626' : '#FECACA', border: 'none', color: '#fff', fontWeight: 700, fontSize: 14, cursor: restoreText === 'RESTORE' && !restoreBusy ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 8 }}>
                <RotateCcw size={16} /> {restoreBusy ? 'Restoring…' : 'Restore now'}
              </button>
            </div>
          </div>
        </div>
      )}

      {dirty && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 18px', borderRadius: 12, marginBottom: 16,
          background: '#FFFBEB', border: '1px solid #FDE68A',
          color: '#92400E', fontSize: 14, fontWeight: 600
        }}>
          ⚠ You have unsaved changes — they won't apply until you click Save Settings. Switching tabs discards them.
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '14px 32px', borderRadius: 12,
          background: saving ? '#94A3B8' : dirty ? '#D97706' : '#0D7377', border: 'none', color: '#fff',
          fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', fontSize: 16
        }}
      >
        <Save size={18} /> {saving ? 'Saving...' : 'Save Settings'}
      </button>
    </div>
  );
}
