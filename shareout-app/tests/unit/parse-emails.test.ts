import { describe, expect, it } from 'vitest';
import { parseEmails } from '../../src/workspaces/parse-emails';

describe('parseEmails', () => {
  it('splits commas, semicolons, spaces and newlines, lowercases and dedupes', () => {
    expect(parseEmails('A@x.com, b@x.com;c@x.com d@x.com\ne@x.com\r\na@X.com')).toEqual({
      emails: ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'],
      invalid: [],
    });
  });

  it('reads "Name <email>", mailto: and quoted forms', () => {
    expect(parseEmails('Ana Pérez <ana@x.com>, "bob@x.com", mailto:carl@x.com, (dee@x.com).').emails)
      .toEqual(['ana@x.com', 'bob@x.com', 'carl@x.com', 'dee@x.com']);
  });

  it('takes a pasted spreadsheet block and ignores names and headers', () => {
    const sheet = 'Name\tEmail\nAna Pérez\tana@x.com\nLuis Gómez\tluis@x.co.uk\n';
    expect(parseEmails(sheet)).toEqual({ emails: ['ana@x.com', 'luis@x.co.uk'], invalid: [] });
  });

  it('flags tokens with an @ that are not addresses', () => {
    expect(parseEmails('ok@x.com, nope@, @x.com, a@b')).toEqual({ emails: ['ok@x.com'], invalid: ['nope@', '@x.com', 'a@b'] });
  });

  it('accepts an array whose items may hold several addresses', () => {
    expect(parseEmails(['a@x.com', 'b@x.com, c@x.com', 7]).emails).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
  });

  it('returns nothing for non-string input', () => {
    expect(parseEmails(undefined)).toEqual({ emails: [], invalid: [] });
    expect(parseEmails({ a: 1 })).toEqual({ emails: [], invalid: [] });
  });
});
