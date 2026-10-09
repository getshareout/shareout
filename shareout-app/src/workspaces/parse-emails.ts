/**
 * Turn whatever an admin pasted into a clean list of email addresses.
 *
 * Accepts a string or an array of strings, each holding any mix of commas, semicolons,
 * spaces, newlines, tabs (a spreadsheet column or row), `Name <email>` and `mailto:`.
 * Tokens without an `@` (names, a column header) are ignored; tokens with one that
 * still aren't an address come back in `invalid` so the caller can say which.
 *
 * The home shell keeps a copy of this logic in client-script/home-views/invite.ts
 * (it can't import TS); keep the two in step.
 */
const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export interface ParsedEmails {
  /** Valid, lowercased, deduped, in first-seen order. */
  emails: string[];
  /** Tokens that looked like an address (had an `@`) but aren't one, deduped. */
  invalid: string[];
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

export function parseEmails(input: unknown): ParsedEmails {
  const raw = Array.isArray(input) ? input.map((v) => String(v ?? '')).join('\n') : typeof input === 'string' ? input : '';
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const piece of raw.split(/[,;\n\r\t]+/)) {
    const angled = piece.match(/<([^<>]*@[^<>]*)>/);
    const tokens = angled ? [angled[1]] : piece.split(/\s+/);
    for (const tok of tokens) {
      if (!tok.includes('@')) continue;
      const email = tok.trim().replace(/^mailto:/i, '').replace(/^["'(<[]+|["')>\].:]+$/g, '').toLowerCase();
      const list = isValidEmail(email) ? emails : invalid;
      if (!list.includes(email)) list.push(email);
    }
  }
  return { emails, invalid };
}
