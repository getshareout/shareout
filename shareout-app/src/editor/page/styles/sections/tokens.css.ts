/**
 * ShareOut Visual Editor styles — Design tokens — ShareOut design system variables and dark mode overrides
 * @module editor/page/styles/sections/tokens
 */

import { colors, fonts, radius, shadows, animation, layout } from '../../../../design-system/tokens';

/** CSS for the tokens section of the visual editor. */
export const tokensCss = `

/* ==========================================================================
   1. DESIGN TOKENS - ShareOut Design System
   ========================================================================== */
:root {
  /* Colors - ShareOut blue primary */
  --primary: ${colors.primary};
  --primary-hover: ${colors.primaryHover};
  --primary-light: ${colors.primaryLight};
  --primary-soft: ${colors.primaryLight};
  --primary-dark: ${colors.primaryHover};

  /* Backgrounds */
  --bg-canvas: ${colors.bg};
  --bg-panel: ${colors.bgElevated};
  --bg-hover: ${colors.surface};
  --bg-active: ${colors.primaryLight};
  --bg-muted: ${colors.surface};

  /* Text */
  --text-primary: ${colors.text};
  --text-secondary: ${colors.textSecondary};
  --text-muted: ${colors.textTertiary};
  --text-inverse: ${colors.textInverse};

  /* Borders */
  --border-light: ${colors.border};
  --border-medium: ${colors.borderStrong};
  --border-strong: ${colors.borderStrong};

  /* Feedback */
  --success: ${colors.success};
  --success-soft: ${colors.successLight};
  --error: ${colors.error};
  --error-soft: ${colors.errorLight};
  --warning: ${colors.warning};
  --warning-soft: ${colors.warningLight};

  /* Layout */
  --topbar-height: ${layout.topbarHeight};
  --chat-collapsed: 100px;
  --chat-focused: 300px;
  --chat-max: 70vh;
  --touch-target: ${layout.touchTarget};
  --spacing-unit: 8px;

  /* Shape — brand radius scale */
  --radius-sm: ${radius.sm};
  --radius-md: ${radius.md};
  --radius-lg: ${radius.lg};
  --radius-xl: ${radius.xl};
  --radius-pill: ${radius.full};

  /* Shadows */
  --shadow-sm: ${shadows.sm};
  --shadow-md: ${shadows.md};
  --shadow-lg: ${shadows.lg};
  --shadow-xl: ${shadows.xl};
  --shadow-float: 0 4px 16px rgba(28, 25, 23, 0.1), 0 0 0 1px rgba(28, 25, 23, 0.04);

  /* Motion */
  --ease-out: ${animation.easeOut};
  --ease-in-out: ${animation.easeInOut};
  --ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1);
  --duration-fast: ${animation.durationFast};
  --duration-normal: ${animation.durationNormal};
  --duration-slow: ${animation.durationSlow};

  /* Typography */
  --font-display: ${fonts.display};
  --font-sans: ${fonts.body};
  --font-mono: ${fonts.mono};

  /* Studio rail — warm liquid glass */
  --rail-width: 380px;
  --glass-bg: rgba(255, 253, 250, 0.72);
  --glass-border: color-mix(in srgb, ${colors.border} 70%, transparent);
  --glass-blur: 18px;
  --glass-shadow: 0 8px 40px color-mix(in srgb, ${colors.text} 12%, transparent), inset 0 0 0 1px rgba(255, 255, 255, 0.45);

  /* Bridge shared component library (--color-* namespace) */
  --color-primary: var(--primary);
  --color-primary-hover: var(--primary-hover);
  --color-primary-light: var(--primary-light);
  --color-bg: var(--bg-canvas);
  --color-bg-elevated: var(--bg-panel);
  --color-surface: var(--bg-hover);
  --color-text: var(--text-primary);
  --color-text-secondary: var(--text-secondary);
  --color-text-tertiary: var(--text-muted);
  --color-text-inverse: var(--text-inverse);
  --color-border: var(--border-light);
  --color-border-strong: var(--border-medium);
  --color-success: var(--success);
  --color-success-light: var(--success-soft);
  --color-warning: var(--warning);
  --color-warning-light: var(--warning-soft);
  --color-error: var(--error);
  --color-error-light: var(--error-soft);
  --touch-target-min: ${layout.touchTargetMin};
}

/* Dark mode */
[data-theme="dark"] {
  --bg-canvas: ${colors.text};
  --bg-panel: color-mix(in srgb, ${colors.text} 90%, ${colors.bgElevated});
  --bg-hover: color-mix(in srgb, ${colors.text} 82%, ${colors.surface});
  --bg-active: color-mix(in srgb, ${colors.primary} 22%, ${colors.text});
  --bg-muted: color-mix(in srgb, ${colors.text} 78%, ${colors.surface});
  --text-primary: ${colors.bg};
  --text-secondary: ${colors.textTertiary};
  --text-muted: color-mix(in srgb, ${colors.textTertiary} 85%, ${colors.bg});
  --border-light: color-mix(in srgb, ${colors.text} 70%, ${colors.borderStrong});
  --border-medium: color-mix(in srgb, ${colors.text} 60%, ${colors.borderStrong});
  --border-strong: color-mix(in srgb, ${colors.textSecondary} 70%, ${colors.border});
  --primary-soft: color-mix(in srgb, ${colors.primary} 22%, ${colors.text});
  --glass-bg: color-mix(in srgb, ${colors.text} 88%, ${colors.bgElevated} 12%);
  --glass-border: color-mix(in srgb, ${colors.text} 70%, ${colors.border});
  --glass-shadow: 0 8px 40px rgba(0, 0, 0, 0.4), inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}
`;
