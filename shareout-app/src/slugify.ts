// The one slugifier for URL-facing names (artifacts, folders, workspaces, skills, connectors...).
// Accented letters are transliterated ("Gestión" -> "gestion"), never replaced by a dash, which used
// to leave slugs like "gesti-n".

const SPECIAL: Record<string, string> = {
  'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ł': 'l', 'ı': 'i', 'ħ': 'h',
};

/** Lowercase ASCII fold: strips combining marks (NFD) and maps letters that have no decomposition. */
export function asciiFold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[ßæœøđðþłıħ]/g, (c) => SPECIAL[c]);
}

/** `a-z0-9` runs joined by single dashes, no leading/trailing dash, cut to `max`. '' when nothing survives. */
export function slugify(name: string, max?: number): string {
  const slug = asciiFold(name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return max ? slug.slice(0, max) : slug;
}

/** The pre-transliteration algorithm ("gestión" -> "gesti-n"). Only for finding slugs that older versions wrote. */
export function legacySlugify(name: string, max?: number): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return max ? slug.slice(0, max) : slug;
}
