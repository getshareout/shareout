export function isSheetsAuthCallback(request: Request): boolean {
  const state = new URL(request.url).searchParams.get('state');
  if (!state) return false;

  try {
    const parsed = JSON.parse(atob(state));
    return parsed?.shareoutSheetsAuth === true && typeof parsed.artifactId === 'string';
  } catch {
    return false;
  }
}

export function isGitHubAuthCallback(request: Request): boolean {
  const state = new URL(request.url).searchParams.get('state');
  if (!state) return false;

  try {
    const parsed = JSON.parse(atob(state));
    return parsed?.shareoutGitHubAuth === true && typeof parsed.artifactId === 'string';
  } catch {
    return false;
  }
}
