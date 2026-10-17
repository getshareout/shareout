import type { HomeCopyTable, HomeLocale, HomeLocaleCopy } from './types';
import { ACCOUNT_COPY } from './copy/account';
import { ADMIN_COPY } from './copy/admin';
import { AGENT_COPY } from './copy/agent';
import { ASSETS_COPY } from './copy/assets';
import { AUTOMATION_COPY } from './copy/automation';
import { CLIENTS_COPY } from './copy/clients';
import { CLIENT_PORTAL_COPY } from './copy/client-portal';
import { COMPOSER_COPY } from './copy/composer';
import { CONNECT_COPY } from './copy/connect';
import { DROP_IMPORT_COPY } from './copy/drop-import';
import { ERRORS_COPY } from './copy/errors';
import { FILE_IMPORT_COPY } from './copy/file-import';
import { FOLDER_ACCESS_COPY } from './copy/folder-access';
import { FOLDER_CONTENTS_COPY } from './copy/folder-contents';
import { GUEST_COMMENTS_COPY } from './copy/guest-comments';
import { INSPECTOR_COPY } from './copy/inspector';
import { INVITE_COPY } from './copy/invite';
import { KNOWLEDGE_MAP_COPY } from './copy/knowledge-map';
import { KNOWLEDGE_LINKS_COPY } from './copy/knowledge-links';
import { LIBRARY_COPY } from './copy/library';
import { MODALS_COPY } from './copy/modals';
import { NEW_MENU_COPY } from './copy/new-menu';
import { NOTIF_COPY } from './copy/notifications';
import { REVIEW_COPY } from './copy/review';
import { PAGES_COPY } from './copy/pages';
import { ONBOARDING_COPY } from './copy/onboarding';
import { SEARCH_COPY } from './copy/search';
import { SHELL_COPY } from './copy/shell';
import { STUDIO_COPY } from './copy/studio';
import { TIME_COPY } from './copy/time';
import { VERSION_CHANGELOG_COPY } from './copy/version-changelog';
import { WORKSPACE_COPY } from './copy/workspace';

/** Domain modules in stable merge order (shell first for readability in diffs). */
const COPY_MODULES: HomeLocaleCopy[] = [
  SHELL_COPY,
  SEARCH_COPY,
  ADMIN_COPY,
  INVITE_COPY,
  CLIENTS_COPY,
  ASSETS_COPY,
  WORKSPACE_COPY,
  FOLDER_ACCESS_COPY,
  FOLDER_CONTENTS_COPY,
  GUEST_COMMENTS_COPY,
  CLIENT_PORTAL_COPY,
  AUTOMATION_COPY,
  KNOWLEDGE_MAP_COPY,
  KNOWLEDGE_LINKS_COPY,
  LIBRARY_COPY,
  CONNECT_COPY,
  COMPOSER_COPY,
  ACCOUNT_COPY,
  INSPECTOR_COPY,
  REVIEW_COPY,
  ONBOARDING_COPY,
  MODALS_COPY,
  NOTIF_COPY,
  AGENT_COPY,
  TIME_COPY,
  STUDIO_COPY,
  NEW_MENU_COPY,
  DROP_IMPORT_COPY,
  FILE_IMPORT_COPY,
  PAGES_COPY,
  ERRORS_COPY,
  VERSION_CHANGELOG_COPY,
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
