// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createOrUpdateFile,
  createRepo,
  getFile,
  getRepo,
  listUserRepos,
  parseRepoString,
  repoExists,
} from '../../../src/data/github/github-api';

const TOKEN = 'gho_test_token';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('github-api', () => {
  describe('createRepo', () => {
    it('creates a repo with defaults', async () => {
      const repo = {
        name: 'my-repo',
        full_name: 'octocat/my-repo',
        html_url: 'https://github.com/octocat/my-repo',
        default_branch: 'main',
        private: false,
      };
      vi.stubGlobal('fetch', vi.fn(async (url, init) => {
        expect(String(url)).toBe('https://api.github.com/user/repos');
        expect(init?.method).toBe('POST');
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          name: 'my-repo',
          description: 'Published via ShareOut',
          private: false,
          auto_init: false,
        });
        expect(init?.headers).toMatchObject({
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
        });
        return jsonResponse(repo);
      }));

      const result = await createRepo(TOKEN, { name: 'my-repo' });
      expect(result).toEqual(repo);
    });

    it('creates a private repo with a custom description', async () => {
      vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          name: 'secret',
          description: 'Custom desc',
          private: true,
        });
        return jsonResponse({ name: 'secret', full_name: 'o/secret', html_url: '', default_branch: 'main', private: true });
      }));

      await createRepo(TOKEN, { name: 'secret', description: 'Custom desc', private: true });
    });

    it('throws with GitHub error message', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'name already exists' }, 422)));

      await expect(createRepo(TOKEN, { name: 'dup' })).rejects.toThrow('name already exists');
    });

    it('throws with status when error body has no message', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 500)));

      await expect(createRepo(TOKEN, { name: 'fail' })).rejects.toThrow('Failed to create repo: 500');
    });
  });

  describe('repoExists', () => {
    it('returns true when repo exists', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url) => {
        expect(String(url)).toBe('https://api.github.com/repos/octocat/existing');
        return new Response(null, { status: 200 });
      }));

      await expect(repoExists(TOKEN, 'octocat', 'existing')).resolves.toBe(true);
    });

    it('returns false when repo is missing', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));

      await expect(repoExists(TOKEN, 'octocat', 'missing')).resolves.toBe(false);
    });
  });

  describe('getRepo', () => {
    it('returns repo data on success', async () => {
      const repo = {
        name: 'repo',
        full_name: 'octocat/repo',
        html_url: 'https://github.com/octocat/repo',
        default_branch: 'main',
        private: false,
      };
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(repo)));

      await expect(getRepo(TOKEN, 'octocat', 'repo')).resolves.toEqual(repo);
    });

    it('returns null on failure', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));

      await expect(getRepo(TOKEN, 'octocat', 'missing')).resolves.toBeNull();
    });
  });

  describe('getFile', () => {
    it('fetches file without branch', async () => {
      const file = { sha: 'abc', content: 'dGVzdA==' };
      vi.stubGlobal('fetch', vi.fn(async (url) => {
        expect(String(url)).toBe('https://api.github.com/repos/o/r/contents/index.html');
        return jsonResponse(file);
      }));

      await expect(getFile(TOKEN, 'o', 'r', 'index.html')).resolves.toEqual(file);
    });

    it('fetches file with branch ref', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url) => {
        expect(String(url)).toBe('https://api.github.com/repos/o/r/contents/path%2Ffile.js?ref=dev%2Fbranch');
        return jsonResponse({ sha: 'x', content: '' });
      }));

      await expect(getFile(TOKEN, 'o', 'r', 'path/file.js', 'dev/branch')).resolves.toEqual({ sha: 'x', content: '' });
    });

    it('returns null when file is missing', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));

      await expect(getFile(TOKEN, 'o', 'r', 'missing.txt')).resolves.toBeNull();
    });
  });

  describe('createOrUpdateFile', () => {
    it('creates a file with optional sha and branch', async () => {
      const commit = { sha: 'file-sha', commit: { sha: 'commit-sha', html_url: 'https://github.com/o/r/commit/sha' } };
      vi.stubGlobal('fetch', vi.fn(async (url, init) => {
        expect(String(url)).toBe('https://api.github.com/repos/o/r/contents/README.md');
        expect(init?.method).toBe('PUT');
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual({
          message: 'Update README',
          content: 'aGVsbG8=',
          sha: 'old-sha',
          branch: 'main',
        });
        return jsonResponse(commit);
      }));

      const result = await createOrUpdateFile(
        TOKEN,
        'o',
        'r',
        'README.md',
        'aGVsbG8=',
        'Update README',
        { sha: 'old-sha', branch: 'main' },
      );
      expect(result).toEqual(commit);
    });

    it('throws with GitHub error message', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'invalid sha' }, 409)));

      await expect(
        createOrUpdateFile(TOKEN, 'o', 'r', 'f.txt', 'x', 'msg'),
      ).rejects.toThrow('invalid sha');
    });

    it('throws with status when error body has no message', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 500)));

      await expect(
        createOrUpdateFile(TOKEN, 'o', 'r', 'f.txt', 'x', 'msg'),
      ).rejects.toThrow('Failed to create/update file: 500');
    });
  });

  describe('listUserRepos', () => {
    it('lists repos with default pagination', async () => {
      const repos = [{ name: 'a', full_name: 'o/a', html_url: '', default_branch: 'main', private: false }];
      vi.stubGlobal('fetch', vi.fn(async (url) => {
        const parsed = new URL(String(url));
        expect(parsed.pathname).toBe('/user/repos');
        expect(parsed.searchParams.get('sort')).toBe('updated');
        expect(parsed.searchParams.get('per_page')).toBe('30');
        expect(parsed.searchParams.get('page')).toBe('1');
        expect(parsed.searchParams.get('affiliation')).toBe('owner,collaborator');
        return jsonResponse(repos);
      }));

      await expect(listUserRepos(TOKEN)).resolves.toEqual(repos);
    });

    it('lists repos with custom options', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url) => {
        const parsed = new URL(String(url));
        expect(parsed.searchParams.get('sort')).toBe('created');
        expect(parsed.searchParams.get('per_page')).toBe('10');
        expect(parsed.searchParams.get('page')).toBe('2');
        return jsonResponse([]);
      }));

      await expect(listUserRepos(TOKEN, { page: 2, perPage: 10, sort: 'created' })).resolves.toEqual([]);
    });

    it('throws when listing fails', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));

      await expect(listUserRepos(TOKEN)).rejects.toThrow('Failed to list repos: 401');
    });
  });

  describe('parseRepoString', () => {
    it('parses owner/repo strings', () => {
      expect(parseRepoString('octocat/hello-world')).toEqual({ owner: 'octocat', repo: 'hello-world' });
    });

    it('returns null for invalid strings', () => {
      expect(parseRepoString('invalid')).toBeNull();
      expect(parseRepoString('a/b/c')).toBeNull();
      expect(parseRepoString('/repo')).toBeNull();
      expect(parseRepoString('owner/')).toBeNull();
    });
  });
});
