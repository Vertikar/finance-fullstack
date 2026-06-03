// ── Theme palettes ─────────────────────────────────────────────────────────────
// Single source of truth for all colour decisions.
// Consumed by App.js, AuthScreen.js and any future themed components.
export const THEMES = {
  dark: {
    bg:            "#0b0d14",
    bgHeader:      "#0f1119",
    bgCard:        "#12141e",
    bgInner:       "#0e1019",
    bgSubtle:      "#191d2e",
    border:        "#191d2e",
    border2:       "#252840",
    text:          "#ddd8cc",
    textMuted:     "#3a3f5a",
    textVeryMuted: "#2e3350",
    textMid:       "#7a8299",
    accent:        "#c4a24a",
    accentText:    "#0b0d14",
    income:        "#4ade80",
    expense:       "#f87171",
    warn:          "#fbbf24",
    scrollThumb:   "#222536",
    errorBg:       "#2a1010",
    errorBorder:   "#f8717133",
    modalOverlay:  "rgba(5,6,12,0.85)",
    tooltipBg:     "#12141e",
    tooltipBorder: "#252840",
  },
  light: {
    bg:            "#f5f2ec",
    bgHeader:      "#ffffff",
    bgCard:        "#ffffff",
    bgInner:       "#f7f4ee",
    bgSubtle:      "#ece8df",
    border:        "#e2ddd4",
    border2:       "#ccc7bc",
    text:          "#1a1610",
    textMuted:     "#9a9080",
    textVeryMuted: "#c0b8ae",
    textMid:       "#6a6258",
    accent:        "#9a7830",
    accentText:    "#ffffff",
    income:        "#16a34a",
    expense:       "#dc2626",
    warn:          "#b45309",
    scrollThumb:   "#ccc7bc",
    errorBg:       "#fff0f0",
    errorBorder:   "#dc262633",
    modalOverlay:  "rgba(20,18,14,0.5)",
    tooltipBg:     "#ffffff",
    tooltipBorder: "#e2ddd4",
  },
};

// ── Theme-toggle icons ─────────────────────────────────────────────────────────
export function SunIcon({ color }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color}
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1"     x2="12" y2="3"/>
      <line x1="12" y1="21"    x2="12" y2="23"/>
      <line x1="4.22" y1="4.22"   x2="5.64" y2="5.64"/>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1"  y1="12"    x2="3"  y2="12"/>
      <line x1="21" y1="12"    x2="23" y2="12"/>
      <line x1="4.22" y1="19.78"  x2="5.64" y2="18.36"/>
      <line x1="18.36" y1="5.64"  x2="19.78" y2="4.22"/>
    </svg>
  );
}

export function MoonIcon({ color }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color}
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}
