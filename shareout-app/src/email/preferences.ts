import type { Env } from '../types';

export type EmailCategory = 'transactional' | 'product' | 'commercial' | 'marketing';

// Default opt state when a user has no explicit row. transactional always sends
// (never stored). marketing is opt-in (off) per the product decision; product and
// commercial are on by default (commercial is additionally audience-gated in the
// gateway, so members never receive it regardless of this default).
const DEFAULT_OPTED_IN: Record<EmailCategory, boolean> = {
  transactional: true,
  product: true,
  commercial: true,
  marketing: false,
};

/** Whether a category may be sent to this user, honouring stored opt state. */
export async function isCategoryAllowed(
  env: Env,
  userId: string,
  category: EmailCategory,
): Promise<boolean> {
  if (category === 'transactional') return true;
  const row = await env.DB.prepare(
    'SELECT opted_in FROM email_preferences WHERE user_id = ? AND category = ?',
  )
    .bind(userId, category)
    .first<{ opted_in: number }>();
  if (!row) return DEFAULT_OPTED_IN[category];
  return row.opted_in === 1;
}

export async function setPreference(
  env: Env,
  userId: string,
  category: EmailCategory,
  optedIn: boolean,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO email_preferences (user_id, category, opted_in, updated_at)
     VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(user_id, category) DO UPDATE SET opted_in = excluded.opted_in, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  )
    .bind(userId, category, optedIn ? 1 : 0)
    .run();
}

export interface CategoryPreference {
  category: EmailCategory;
  optedIn: boolean;
  default: boolean;
}

/** All toggleable categories with effective state — feeds the preference center. */
export async function getPreferences(env: Env, userId: string): Promise<CategoryPreference[]> {
  const rows = await env.DB.prepare(
    'SELECT category, opted_in FROM email_preferences WHERE user_id = ?',
  )
    .bind(userId)
    .all<{ category: string; opted_in: number }>();
  const stored = new Map(rows.results.map((r) => [r.category, r.opted_in === 1]));
  return (['product', 'commercial', 'marketing'] as EmailCategory[]).map((category) => ({
    category,
    optedIn: stored.has(category) ? stored.get(category)! : DEFAULT_OPTED_IN[category],
    default: DEFAULT_OPTED_IN[category],
  }));
}
