// Kiosk theme: derives every shade the kiosk screens need from the org's two
// brand colors (settings.primary_color / settings.accent_color). KioskWelcome
// loads them from /kiosk/config and caches them so KioskSignIn/KioskSignOut
// theme instantly on open.

export const DEFAULT_PRIMARY = '#0D7377';
export const DEFAULT_ACCENT = '#FF6B35';

const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));

const hexToRgb = (hex) => {
  const m = String(hex || '').trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(m)) return null;
  return { r: parseInt(m.slice(0, 2), 16), g: parseInt(m.slice(2, 4), 16), b: parseInt(m.slice(4, 6), 16) };
};

// Lighten a hex color toward white. amt 0..1 (0 = unchanged, 1 = white).
export const lighten = (hex, amt) => {
  const c = hexToRgb(hex);
  if (!c) return hex;
  const f = (v) => clamp(v + (255 - v) * amt).toString(16).padStart(2, '0');
  return `#${f(c.r)}${f(c.g)}${f(c.b)}`;
};

// Darken a hex color toward black. amt 0..1 (0 = unchanged, 1 = black).
export const darken = (hex, amt) => {
  const c = hexToRgb(hex);
  if (!c) return hex;
  const f = (v) => clamp(v * (1 - amt)).toString(16).padStart(2, '0');
  return `#${f(c.r)}${f(c.g)}${f(c.b)}`;
};

export const withAlpha = (hex, a) => {
  const c = hexToRgb(hex);
  if (!c) return hex;
  return `rgba(${c.r},${c.g},${c.b},${a})`;
};

const validHex = (v) => !!hexToRgb(v);

// All the tones used across the three kiosk screens, from two brand colors.
export function buildTheme(primary, accent) {
  const p = validHex(primary) ? primary : DEFAULT_PRIMARY;
  const a = validHex(accent) ? accent : DEFAULT_ACCENT;
  return {
    primary: p,                                   // base brand color (buttons, headers)
    accent: a,                                    // highlight / primary CTA
    primarySoft: lighten(p, 0.18),                // gradient partner (≈ #14919B on default)
    primaryDark: darken(p, 0.2),                  // page background mid-stop (≈ #0A5C5F on default)
    primaryBright: lighten(p, 0.5),               // bright on-dark accent (≈ #14FFEC on default)
    primaryDim: withAlpha(p, 0.4),                // disabled primary
    accentSoft: lighten(a, 0.14),                 // gradient partner (≈ #FF8C5A on default)
    accentDim: withAlpha(a, 0.35),                // disabled accent
    brightDim: withAlpha(lighten(p, 0.5), 0.08),  // faint bright wash (badges, chips)
    accentWash: withAlpha(a, 0.08),                 // faint accent glow (page corners)
    brightBorder: withAlpha(lighten(p, 0.5), 0.2), // card borders on dark
  };
}

export const DEFAULT_THEME = buildTheme(DEFAULT_PRIMARY, DEFAULT_ACCENT);

export function getCachedTheme() {
  try {
    const raw = localStorage.getItem('kiosk_theme');
    if (raw) {
      const t = JSON.parse(raw);
      if (t && validHex(t.primary) && validHex(t.accent)) return buildTheme(t.primary, t.accent);
    }
  } catch { /* ignore */ }
  return DEFAULT_THEME;
}

export function cacheTheme(primary, accent) {
  try { localStorage.setItem('kiosk_theme', JSON.stringify({ primary, accent })); } catch { /* ignore */ }
  // Let the kiosk layout (page background) react immediately, without a reload
  try { window.dispatchEvent(new Event('kiosk-theme')); } catch { /* ignore */ }
}
