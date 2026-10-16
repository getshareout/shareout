import type { LocaleCopy } from '../i18n';

// Telegram lines for the review and sharing notifications, in the recipient's language.
// The emails live in src/email/catalog-notify.ts.

const en = {
  approved: (who: string, title: string, v: number | null) => `${who} approved ${v ? `version ${v}` : 'the live version'} of "${title}"`,
  folderOpened: (who: string, item: string, folder: string) => `${who} opened "${item}" in your shared folder "${folder}"`,
  newVersion: (title: string, v: number, count: number) => (count > 1 ? `"${title}" has ${count} new versions (up to version ${v})` : `"${title}" has a new version (version ${v})`),
  folderShared: (who: string, folder: string) => `${who} shared the folder "${folder}" with you`,
};

const es: typeof en = {
  approved: (who, title, v) => `${who} aprobó ${v ? `la versión ${v}` : 'la versión publicada'} de "${title}"`,
  folderOpened: (who, item, folder) => `${who} abrió "${item}" en tu carpeta compartida "${folder}"`,
  newVersion: (title, v, count) => (count > 1 ? `"${title}" tiene ${count} versiones nuevas (hasta la versión ${v})` : `"${title}" tiene una versión nueva (versión ${v})`),
  folderShared: (who, folder) => `${who} compartió con vos la carpeta "${folder}"`,
};

export const NOTIFY_TG: LocaleCopy<typeof en> = { en, es };
