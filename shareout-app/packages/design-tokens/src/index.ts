/**
 * ShareOut Design System - Design Tokens
 * Single source of truth for all visual design values (plan §12).
 * Aligned with Design/visual/color.md and Design/system/tokens.md.
 */

// =============================================================================
// COLORS
// =============================================================================

export const colors = {
  // Primary - The ONE action color
  primary: '#2563eb',
  primaryHover: '#1d4ed8',
  primaryLight: '#eff6ff',
  primaryGlow: 'rgba(37, 99, 235, 0.25)',
  primaryAlpha15: 'rgba(37, 99, 235, 0.15)',

  // Backgrounds - Warm, not clinical
  bg: '#fafaf9',
  bgElevated: '#ffffff',
  surface: '#f5f5f4',

  // Text
  text: '#1c1917',
  textSecondary: '#57534e',
  textTertiary: '#a8a29e',
  textInverse: '#ffffff',

  // Borders
  border: '#e7e5e4',
  borderStrong: '#d6d3d1',

  // Feedback
  success: '#16a34a',
  successLight: '#f0fdf4',
  warning: '#ca8a04',
  warningLight: '#fefce8',
  error: '#dc2626',
  errorLight: '#fef2f2',
} as const;

// =============================================================================
// TYPOGRAPHY
// =============================================================================

export const fonts = {
  display: "'Satoshi', 'Instrument Sans', 'Avenir Next', system-ui, sans-serif",
  body: "'Source Sans 3', 'Segoe UI', system-ui, sans-serif",
  mono: "'JetBrains Mono', 'SF Mono', monospace",
} as const;

export const fontWeights = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

export const fontSizes = {
  xs: '12px',
  sm: '13px',
  base: '15px',
  md: '16px',
  lg: '18px',
  xl: '20px',
  '2xl': '24px',
  '3xl': '28px',
  '4xl': '32px',
} as const;

// =============================================================================
// SPACING (8px base)
// =============================================================================

export const spacing = {
  0: '0',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
  24: '96px',
  32: '128px',
} as const;

// =============================================================================
// BORDERS & RADIUS
// =============================================================================

/** sm = small components, md = cards, lg = modals, xl = large surfaces */
export const radius = {
  sm: '12px',
  md: '16px',
  lg: '20px',
  xl: '24px',
  full: '9999px',
} as const;

// =============================================================================
// SHADOWS
// =============================================================================

export const shadows = {
  sm: '0 1px 2px rgba(28, 25, 23, 0.04)',
  md: '0 2px 8px rgba(28, 25, 23, 0.06)',
  lg: '0 4px 16px rgba(28, 25, 23, 0.08)',
  xl: '0 8px 24px rgba(28, 25, 23, 0.1)',
} as const;

// =============================================================================
// ANIMATION
// =============================================================================

export const animation = {
  durationFast: '100ms',
  durationNormal: '150ms',
  durationSlow: '250ms',
  easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
  easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

// =============================================================================
// LAYOUT
// =============================================================================

export const layout = {
  touchTarget: '48px',
  touchTargetMin: '44px',
  topbarHeight: '56px',
  headerHeight: '64px',
  maxWidth: '1080px',
  maxWidthNarrow: '640px',
  maxWidthWide: '1280px',
} as const;

// =============================================================================
// Z-INDEX
// =============================================================================

export const zIndex = {
  dropdown: 100,
  sticky: 200,
  modal: 300,
  popover: 400,
  tooltip: 500,
  toast: 1000,
} as const;

// =============================================================================
// WEB FONTS (Fontshare display + Google body/mono)
// =============================================================================

/** Satoshi display face — https://www.fontshare.com/fonts/satoshi */
export const fontshareDisplayUrl =
  'https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap';

/** Source Sans 3 (body) + JetBrains Mono — display loaded via Fontshare */
export const googleFontsUrl =
  'https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap';

export const webFontsHead = `
  <link rel="preconnect" href="https://api.fontshare.com" crossorigin>
  <link rel="preconnect" href="https://cdn.fontshare.com" crossorigin>
  <link href="${fontshareDisplayUrl}" rel="stylesheet">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="${googleFontsUrl}" rel="stylesheet">
`;

/** @deprecated alias — loads Satoshi + Google Fonts */
export const googleFontsPreconnect = webFontsHead;

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type Color = keyof typeof colors;
export type Font = keyof typeof fonts;
export type Spacing = keyof typeof spacing;
export type Radius = keyof typeof radius;
export type Shadow = keyof typeof shadows;
