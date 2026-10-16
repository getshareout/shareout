import type { HomeLocaleCopy } from '../types';

/** Folder access note: a folder's setting vs. the more open items inside it. */
export const FOLDER_CONTENTS_COPY: HomeLocaleCopy = {
  en: {
    'artifacts.access.folderIs': 'Folder is {setting}',
    'artifacts.access.morePublicOne': '1 item inside is public',
    'artifacts.access.morePublicMany': '{n} items inside are public',
    'artifacts.access.moreWorkspaceOne': '1 item inside is visible to the workspace',
    'artifacts.access.moreWorkspaceMany': '{n} items inside are visible to the workspace',
    'artifacts.access.openItems': 'More open than this folder',
    'artifacts.access.openItemsMore': 'and {n} more',
    'artifacts.access.openItemsHint': 'Each artifact and file keeps its own visibility. Change it on the item to close it.',
  },
  es: {
    'artifacts.access.folderIs': 'La carpeta es {setting}',
    'artifacts.access.morePublicOne': '1 elemento dentro es público',
    'artifacts.access.morePublicMany': '{n} elementos dentro son públicos',
    'artifacts.access.moreWorkspaceOne': '1 elemento dentro es visible para el espacio',
    'artifacts.access.moreWorkspaceMany': '{n} elementos dentro son visibles para el espacio',
    'artifacts.access.openItems': 'Más abiertos que esta carpeta',
    'artifacts.access.openItemsMore': 'y {n} más',
    'artifacts.access.openItemsHint': 'Cada artefacto y archivo tiene su propia visibilidad. Cambiala en el elemento para cerrarlo.',
  },
};
