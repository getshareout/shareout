export function matchesAllowedPath(path: string, patterns: string[]): boolean {
  const normalizedPath = normalizePath(path);

  for (const pattern of patterns) {
    if (matchPattern(normalizedPath, pattern)) {
      return true;
    }
  }

  return false;
}

function normalizePath(path: string): string {
  let normalized = path.split('?')[0];
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized;
  }
  normalized = normalized.replace(/\/+/g, '/');
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function matchPattern(path: string, pattern: string): boolean {
  const normalizedPattern = normalizePath(pattern);

  if (normalizedPattern === '**' || normalizedPattern === '/**') {
    return true;
  }

  if (!normalizedPattern.includes('*')) {
    return path === normalizedPattern;
  }

  const regex = patternToRegex(normalizedPattern);
  return regex.test(path);
}

function patternToRegex(pattern: string): RegExp {
  let regexStr = '^';
  let i = 0;

  while (i < pattern.length) {
    const char = pattern[i];

    if (char === '*' && pattern[i + 1] === '*') {
      regexStr += '.*';
      i += 2;
      if (pattern[i] === '/') {
        i++;
      }
    } else if (char === '*') {
      regexStr += '[^/]*';
      i++;
    } else if ('/?.+[](){}^$|\\'.includes(char)) {
      regexStr += '\\' + char;
      i++;
    } else {
      regexStr += char;
      i++;
    }
  }

  regexStr += '$';
  return new RegExp(regexStr);
}

export function validatePathPatterns(patterns: string[]): { valid: boolean; error?: string } {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return { valid: false, error: 'At least one path pattern is required' };
  }

  for (const pattern of patterns) {
    if (typeof pattern !== 'string') {
      return { valid: false, error: 'Path patterns must be strings' };
    }

    if (pattern.length > 500) {
      return { valid: false, error: 'Path pattern too long (max 500 chars)' };
    }

    if (pattern.includes('..')) {
      return { valid: false, error: 'Path traversal not allowed' };
    }
  }

  return { valid: true };
}
