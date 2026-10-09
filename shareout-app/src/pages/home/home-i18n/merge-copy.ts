import type { HomeCopyTable, HomeLocale, HomeLocaleCopy } from './types';
import { ACCOUNT_COPY } from './copy/account';
import { ADMIN_COPY } from './copy/admin';
import { AGENT_COPY } from './copy/agent';
import { ASSETS_COPY } from './copy/assets';
import { CLIENTS_COPY } from './copy/clients';
import { COMPOSER_COPY } from './copy/composer';
import { CONNECT_COPY } from './copy/connect';
import { INSPECTOR_COPY } from './copy/inspector';
import { INVITE_COPY } from './copy/invite';
import { KNOWLEDGE_MAP_COPY } from './copy/knowledge-map';
import { LIBRARY_COPY } from './copy/library';
import { MODALS_COPY } from './copy/modals';
import { NOTIF_COPY } from './copy/notifications';
import { ONBOARDING_COPY } from './copy/onboarding';
import { SHELL_COPY } from './copy/shell';
import { STUDIO_COPY } from './copy/studio';
import { TIME_COPY } from './copy/time';
import { WORKSPACE_COPY } from './copy/workspace';

/** Domain modules in stable merge order (shell first for readability in diffs). */
const COPY_MODULES: HomeLocaleCopy[] = [
  SHELL_COPY,
  ADMIN_COPY,
  INVITE_COPY,
  CLIENTS_COPY,
  ASSETS_COPY,
  WORKSPACE_COPY,
  KNOWLEDGE_MAP_COPY,
  LIBRARY_COPY,
  CONNECT_COPY,
  COMPOSER_COPY,
  ACCOUNT_COPY,
  INSPECTOR_COPY,
  ONBOARDING_COPY,
  MODALS_COPY,
  NOTIF_COPY,
  AGENT_COPY,
  TIME_COPY,
  STUDIO_COPY,
];

function mergeLocale(locale: HomeLocale): Record<string, string> {
  return Object.assign({}, ...COPY_MODULES.map((m) => m[locale]));
}

/**
 * Merged EN/ES copy for the workspace home shell.
 * Built from domain modules under `copy/` so each area can evolve independently.
 */
export const HOME_COPY: HomeCopyTable = {
  en: mergeLocale('en'),
  es: mergeLocale('es'),
};
