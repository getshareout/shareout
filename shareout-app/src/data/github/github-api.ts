const GITHUB_API = 'https://api.github.com';

interface GitHubRepo {
  full_name: string;
  html_url: string;
  default_branch: string;
  private: boolean;
  name: string;
}

interface GitHubFile {
  sha: string;
  content: string;
}

interface GitHubCommitResult {
  sha: string;
  commit: { sha: string; html_url: string };
}

function headers(token: string): HeadersInit {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'ShareOut/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export async function createRepo(
  accessToken: string,
  options: {
    name: string;
    description?: string;
    private?: boolean;
  }
): Promise<GitHubRepo> {
  const response = await fetch(`${GITHUB_API}/user/repos`, {
    method: 'POST',
    headers: {
      ...headers(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: options.name,
      description: options.description || 'Published via ShareOut',
      private: options.private ?? false,
      auto_init: false,
    }),
  });

  if (!response.ok) {
    const error = await response.json() as { message?: string };
    throw new Error(error.message || `Failed to create repo: ${response.status}`);
  }

  return response.json() as Promise<GitHubRepo>;
}

export async function repoExists(
  accessToken: string,
  owner: string,
  repo: string
): Promise<boolean> {
  const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
    headers: headers(accessToken),
  });
  return response.ok;
}

export async function getRepo(
  accessToken: string,
  owner: string,
  repo: string
): Promise<GitHubRepo | null> {
  const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
    headers: headers(accessToken),
  });
  if (!response.ok) return null;
  return response.json() as Promise<GitHubRepo>;
}

export async function getFile(
  accessToken: string,
  owner: string,
  repo: string,
  path: string,
  branch?: string
): Promise<GitHubFile | null> {
  let url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  if (branch) url += `?ref=${encodeURIComponent(branch)}`;

  const response = await fetch(url, {
    headers: headers(accessToken),
  });

  if (!response.ok) return null;
  return response.json() as Promise<GitHubFile>;
}

export async function createOrUpdateFile(
  accessToken: string,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  options?: { sha?: string; branch?: string }
): Promise<GitHubCommitResult> {
  const body: Record<string, unknown> = {
    message,
    content,
  };

  if (options?.sha) body.sha = options.sha;
  if (options?.branch) body.branch = options.branch;

  const response = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
    {
      method: 'PUT',
      headers: {
        ...headers(accessToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const error = await response.json() as { message?: string };
    throw new Error(error.message || `Failed to create/update file: ${response.status}`);
  }

  return response.json() as Promise<GitHubCommitResult>;
}

export async function listUserRepos(
  accessToken: string,
  options?: { page?: number; perPage?: number; sort?: string }
): Promise<GitHubRepo[]> {
  const params = new URLSearchParams({
    sort: options?.sort || 'updated',
    per_page: String(options?.perPage || 30),
    page: String(options?.page || 1),
    affiliation: 'owner,collaborator',
  });

  const response = await fetch(`${GITHUB_API}/user/repos?${params}`, {
    headers: headers(accessToken),
  });

  if (!response.ok) {
    throw new Error(`Failed to list repos: ${response.status}`);
  }

  return response.json() as Promise<GitHubRepo[]>;
}

export function parseRepoString(repoString: string): { owner: string; repo: string } | null {
  const parts = repoString.split('/');
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!owner || !repo) return null;
  return { owner, repo };
}
