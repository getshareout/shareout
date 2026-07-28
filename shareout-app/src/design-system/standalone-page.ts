/**
 * Shared styles for standalone HTML pages (OAuth callbacks, error states, etc.)
 * Uses brand tokens — no purple gradients or system-only fonts.
 */

import { colors, fonts, radius, shadows, googleFontsPreconnect } from './tokens';

export { googleFontsPreconnect };

export const standalonePageStyles = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: ${fonts.body};
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: ${colors.bg};
    color: ${colors.text};
    -webkit-font-smoothing: antialiased;
    line-height: 1.5;
  }
  .card {
    background: ${colors.bgElevated};
    padding: 40px;
    border-radius: ${radius.md};
    border: 1px solid ${colors.border};
    box-shadow: ${shadows.md};
    text-align: center;
    max-width: 400px;
    width: 90%;
  }
  .icon {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 20px;
    font-size: 32px;
  }
  .icon.success { background: ${colors.successLight}; color: ${colors.success}; }
  .icon.error { background: ${colors.errorLight}; color: ${colors.error}; }
  h1 {
    font: 600 24px ${fonts.display};
    color: ${colors.text};
    margin-bottom: 12px;
  }
  p {
    font: 400 15px/1.5 ${fonts.body};
    color: ${colors.textSecondary};
    margin-bottom: 20px;
  }
  .close-hint { font-size: 14px; color: ${colors.textTertiary}; }
  a, .btn {
    display: inline-block;
    padding: 12px 24px;
    background: ${colors.primary};
    color: ${colors.textInverse};
    text-decoration: none;
    border-radius: ${radius.sm};
    font: 600 15px ${fonts.body};
    transition: background 0.15s ease;
  }
  a:hover, .btn:hover { background: ${colors.primaryHover}; }
`;
