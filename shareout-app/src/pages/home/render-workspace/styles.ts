/**
 * CSS for the reinvented workspace shell (.wsx). Injected server-side via handler.ts.
 *
 * Assembly only — section CSS lives in styles-*.ts modules (each under the 1000-line
 * guard). Concatenation order matches the original monolith so cascade is unchanged.
 */
import { WORKSPACE_TOKENS } from './constants';
import { WORKSPACE_CATALOG_STYLES } from './styles-catalog';
import { WORKSPACE_NAV_STYLES } from './styles-nav';
import { WORKSPACE_NOTIF_STYLES } from './styles-notifications';
import { WORKSPACE_PALETTE_STYLES } from './styles-palette';
import { WORKSPACE_SHELL_STYLES } from './styles-shell';
import { WORKSPACE_CANVAS_STYLES } from './styles-canvas';
import { WORKSPACE_LENSES_STYLES } from './styles-lenses';
import { WORKSPACE_FORMS_EDIT_STYLES } from './styles-forms-edit';
import { WORKSPACE_SIDEBAR_STYLES } from './styles-sidebar';
import { WORKSPACE_AGENT_COMPOSER_STYLES } from './styles-agent-composer';

export const WORKSPACE_STYLES = `${WORKSPACE_TOKENS}
${WORKSPACE_SHELL_STYLES}${WORKSPACE_CANVAS_STYLES}${WORKSPACE_LENSES_STYLES}${WORKSPACE_FORMS_EDIT_STYLES}${WORKSPACE_SIDEBAR_STYLES}${WORKSPACE_AGENT_COMPOSER_STYLES}${WORKSPACE_NAV_STYLES}${WORKSPACE_CATALOG_STYLES}${WORKSPACE_NOTIF_STYLES}${WORKSPACE_PALETTE_STYLES}`;
