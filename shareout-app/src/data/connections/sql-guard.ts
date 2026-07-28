// Read-only allowlist for LLM-generated SQL run by the workspace assistant. This
// is a SECOND gate, not the boundary — the real boundary is a read-only warehouse
// role on the connection's credentials. We accept only a single SELECT/WITH…SELECT
// statement and reject anything that could mutate or chain. Fail closed.

const FORBIDDEN = [
  'insert', 'update', 'delete', 'drop', 'alter', 'create', 'truncate', 'merge',
  'grant', 'revoke', 'replace', 'call', 'exec', 'execute', 'into', 'copy', 'put',
  'unload', 'use', 'set', 'begin', 'commit', 'rollback', 'attach', 'detach',
  'vacuum', 'pragma', 'comment',
];

export interface SqlGuardResult {
  ok: boolean;
  /** Cleaned SQL (comments stripped, single trailing ';' removed) when ok. */
  sql?: string;
  reason?: string;
}

/** Strip line and block comments so they can't hide keywords. */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

export function validateReadOnlySql(raw: string): SqlGuardResult {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'Empty query.' };

  let sql = stripComments(raw).trim();
  // Allow exactly one trailing semicolon; anything after it = chained statement.
  sql = sql.replace(/;\s*$/, '').trim();
  if (sql.includes(';')) return { ok: false, reason: 'Only a single statement is allowed.' };
  if (!sql) return { ok: false, reason: 'Empty query.' };

  if (!/^\s*(select|with)\b/i.test(sql)) {
    return { ok: false, reason: 'Only SELECT (or WITH … SELECT) queries are allowed.' };
  }

  const lower = sql.toLowerCase();
  for (const kw of FORBIDDEN) {
    if (new RegExp('\\b' + kw + '\\b').test(lower)) {
      return { ok: false, reason: 'Disallowed keyword "' + kw + '" - the assistant can only read data.' };
    }
  }

  return { ok: true, sql };
}
