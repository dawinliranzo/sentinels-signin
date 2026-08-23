// Portal theme: paints the whole admin platform (app.sentinelskiosk.com)
// with the organization's palette. The palette chosen in Settings → Branding
// (primary_color / accent_color) is expanded into CSS custom properties on
// :root; every portal page references var(--brand), var(--accent), etc.
// Defaults in index.css match the original Sentinels teal look, so nothing
// changes for orgs that never pick a palette.

import { buildTheme, lighten, darken, withAlpha, DEFAULT_PRIMARY, DEFAULT_ACCENT } from './kioskTheme';

const KEY = 'portal_theme';

export function applyPortalTheme(primary, accent, { persist = true } = {}) {
  const t = buildTheme(primary || DEFAULT_PRIMARY, accent || DEFAULT_ACCENT);
  const bright = t.primaryBright;
  const vars = {
    '--brand': t.primary,
    '--brand-soft': t.primarySoft,
    '--brand-bright': bright,
    '--brand-dark': t.primaryDark,
    '--brand-deep': darken(t.primary, 0.08),
    '--brand-wash': lighten(t.primary, 0.93),
    '--brand-border': lighten(t.primary, 0.55),
    '--brand-ghost': withAlpha(t.primary, 0.1),
    '--brand-halo': withAlpha(t.primary, 0.15),
    '--bright-soft': withAlpha(bright, 0.12),
    '--bright-mid': withAlpha(bright, 0.4),
    '--accent': t.accent,
    '--accent-soft': t.accentSoft,
  };
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(vars)) root.setProperty(k, v);
  if (persist) {
    try { localStorage.setItem(KEY, JSON.stringify({ primary: t.primary, accent: t.accent })); } catch { /* ignore */ }
  }
}

// Called as early as possible (module scope of index.js) so returning users
// never see a flash of the default teal while settings load.
export function applyCachedPortalTheme() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const t = JSON.parse(raw);
    if (t && (t.primary || t.accent)) applyPortalTheme(t.primary, t.accent, { persist: false });
  } catch { /* ignore */ }
}
