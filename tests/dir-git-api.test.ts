import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { app } from '../src/server/index.js';
import { closeDb, getDb } from '../src/db/index.js';
import { addDirAuthorization } from '../src/db/dir-authorizations.js';
import { getOwnerKey, saveConfig } from '../src/shared/config.js';
import { CONFIG_PATH } from '../src/shared/constants.js';

let oldConfig: string | null = null;

function withTempDb(): string {
  closeDb();
  if (oldConfig === null) oldConfig = existsSync(CONFIG_PATH) ? readFileSync(CONFIG_PATH, 'utf-8') : '';
  const root = mkdtempSync(join(tmpdir(), 'drop-dir-git-api-'));
  process.env.DROP_DB = join(root, 'drop.db');
  return root;
}

function cleanGitEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('GIT_')) env[key] = value;
  }
  return env;
}

function git(args: string[], cwd: string): string {
  const result = Bun.spawnSync(['git', ...args], { cwd, env: cleanGitEnv(), stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

function createRepoWithCommits(root: string, count: number): { repo: string; shas: string[] } {
  const repo = join(root, 'repo');
  mkdirSync(repo);
  git(['init'], repo);
  git(['config', 'core.hooksPath', '/dev/null'], repo);
  git(['config', 'user.email', 'test@example.com'], repo);
  git(['config', 'user.name', 'Test User'], repo);

  const shas: string[] = [];
  for (let i = 1; i <= count; i++) {
    writeFileSync(join(repo, 'note.txt'), `version ${i}\n`);
    git(['add', 'note.txt'], repo);
    git(['commit', '-m', `commit ${i}`], repo);
    shas.unshift(git(['rev-parse', 'HEAD'], repo));
  }
  return { repo, shas };
}

async function unlockGitHistory(
  token: string,
  ownerKey = getOwnerKey(),
  init: RequestInit = {},
  urlPrefix = '',
): Promise<Response> {
  return app.request(`${urlPrefix}/d/${token}/api/git/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    body: JSON.stringify({ owner_key: ownerKey }),
    ...init,
  });
}

function cookieHeader(response: Response): string {
  const setCookie = response.headers.get('set-cookie') || '';
  return setCookie.split(';')[0];
}

afterEach(() => {
  closeDb();
  delete process.env.DROP_DB;
  if (oldConfig !== null) {
    if (oldConfig === '') {
      saveConfig({});
      rmSync(CONFIG_PATH, { force: true });
    } else {
      saveConfig(JSON.parse(oldConfig));
    }
    oldConfig = null;
  }
});

describe('directory git API', () => {
  test('reports whether a shared directory is a git repository', async () => {
    const root = withTempDb();
    try {
      const plainDir = join(root, 'plain');
      mkdirSync(plainDir);
      const plainToken = addDirAuthorization(plainDir, 60, []).token;
      const plainInfo = await app.request(`/d/${plainToken}/api/git`);
      expect(plainInfo.status).toBe(200);
      expect(await plainInfo.json()).toEqual({
        is_git_repo: false,
        default_limit: 5,
        commits_url: null,
      });

      const fakeGitDir = join(root, 'fake-git');
      mkdirSync(join(fakeGitDir, '.git'), { recursive: true });
      const fakeGitToken = addDirAuthorization(fakeGitDir, 60, []).token;
      const fakeGitInfo = await app.request(`/d/${fakeGitToken}/api/git`);
      expect(fakeGitInfo.status).toBe(200);
      expect(await fakeGitInfo.json()).toEqual({
        is_git_repo: false,
        default_limit: 5,
        commits_url: null,
      });

      const { repo } = createRepoWithCommits(root, 1);
      const gitToken = addDirAuthorization(repo, 60, []).token;
      const gitInfo = await app.request(`/d/${gitToken}/api/git`);
      expect(gitInfo.status).toBe(200);
      expect(await gitInfo.json()).toEqual({
        is_git_repo: true,
        default_limit: 5,
        commits_url: `/d/${gitToken}/api/git/commits`,
      });

      const emptyRepo = join(root, 'empty-repo');
      mkdirSync(emptyRepo);
      git(['init'], emptyRepo);
      const emptyToken = addDirAuthorization(emptyRepo, 60, []).token;
      const emptyCommits = await app.request(`/d/${emptyToken}/api/git/commits`);
      expect(emptyCommits.status).toBe(200);
      expect(await emptyCommits.json()).toEqual({ limit: 5, commits: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('lists only the latest five commits without exposing author email', async () => {
    const root = withTempDb();
    try {
      const { repo, shas } = createRepoWithCommits(root, 6);
      const token = addDirAuthorization(repo, 60, []).token;

      const response = await app.request(`/d/${token}/api/git/commits`);
      const json = await response.json() as any;

      expect(response.status).toBe(200);
      expect(json.limit).toBe(5);
      expect(json.commits).toHaveLength(5);
      expect(json.commits.map((c: any) => c.sha)).toEqual(shas.slice(0, 5));
      expect(JSON.stringify(json)).not.toContain('test@example.com');
      expect(json.commits[0]).toEqual(expect.objectContaining({
        short_sha: shas[0].slice(0, 7),
        subject: 'commit 6',
        author_name: 'Test User',
      }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('owner can unlock the current git share to one hundred commits with a scoped signed cookie', async () => {
    const root = withTempDb();
    try {
      const { repo, shas } = createRepoWithCommits(root, 101);
      const token = addDirAuthorization(repo, 60, []).token;

      const locked = await app.request(`/d/${token}/api/git/commits`);
      const lockedJson = await locked.json() as any;
      expect(locked.status).toBe(200);
      expect(lockedJson.limit).toBe(5);
      expect(lockedJson.commits).toHaveLength(5);

      const unlock = await unlockGitHistory(token);
      const unlockJson = await unlock.json() as any;
      expect(unlock.status).toBe(200);
      expect(unlock.headers.get('cache-control')).toBe('no-store');
      const setCookie = unlock.headers.get('set-cookie') || '';
      expect(setCookie).toContain('drop_dir_git_history=');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');
      expect(unlockJson).toEqual(expect.objectContaining({
        unlocked: true,
        limit: 100,
      }));
      expect(JSON.stringify(unlockJson)).not.toContain(getOwnerKey());
      expect(JSON.stringify(unlockJson)).not.toContain(token);
      const cookie = cookieHeader(unlock);

      const expanded = await app.request(`/d/${token}/api/git/commits`, {
        headers: { Cookie: cookie },
      });
      const expandedJson = await expanded.json() as any;
      expect(expanded.status).toBe(200);
      expect(expandedJson.limit).toBe(100);
      expect(expandedJson.unlocked).toBe(true);
      expect(expandedJson.commits).toHaveLength(100);
      expect(expandedJson.commits.map((c: any) => c.sha)).toEqual(shas.slice(0, 100));
      expect(JSON.stringify(expandedJson)).not.toContain('test@example.com');

      const hundredth = await app.request(`/d/${token}/api/git/commit/${shas[99]}`, {
        headers: { Cookie: cookie },
      });
      expect(hundredth.status).toBe(200);

      const hundredFirst = await app.request(`/d/${token}/api/git/commit/${shas[100]}`, {
        headers: { Cookie: cookie },
      });
      expect(hundredFirst.status).toBe(403);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);

  test('unlock endpoint rejects query keys, cross-site requests, and forged cookies without leaking secrets', async () => {
    const root = withTempDb();
    try {
      const { repo } = createRepoWithCommits(root, 6);
      const token = addDirAuthorization(repo, 60, []).token;
      const ownerKey = getOwnerKey();

      const queryKey = await app.request(`/d/${token}/api/git/unlock?key=${encodeURIComponent(ownerKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const queryOwnerKey = await app.request(`/d/${token}/api/git/unlock?owner_key=${encodeURIComponent(ownerKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(queryKey.status).toBe(403);
      expect(queryOwnerKey.status).toBe(403);
      expect(queryKey.headers.get('set-cookie')).toBeNull();
      expect(queryOwnerKey.headers.get('set-cookie')).toBeNull();

      saveConfig({ owner_key: ownerKey, base_url: 'https://drop.example' });
      const sameOriginTunnel = await unlockGitHistory(token, ownerKey, {
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://drop.example',
          'Sec-Fetch-Site': 'same-origin',
          'X-Forwarded-Proto': 'https',
          'X-Forwarded-Host': 'drop.example',
        },
      }, 'http://127.0.0.1:17173');
      expect(sameOriginTunnel.status).toBe(200);
      expect(sameOriginTunnel.headers.get('set-cookie')).toContain('drop_dir_git_history=');

      const crossSite = await unlockGitHistory(token, ownerKey, {
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://evil.example',
          'Sec-Fetch-Site': 'cross-site',
        },
      }, 'https://drop.example');
      const crossSiteText = await crossSite.text();
      expect(crossSite.status).toBe(403);
      expect(crossSite.headers.get('set-cookie')).toBeNull();

      const forged = await app.request(`/d/${token}/api/git/commits`, {
        headers: { Cookie: 'drop_dir_git_history=forged' },
      });
      const forgedJson = await forged.json() as any;
      expect(forged.status).toBe(200);
      expect(forgedJson.limit).toBe(5);
      expect(forgedJson.commits).toHaveLength(5);

      const wrongKey = await unlockGitHistory(token, `${ownerKey}-wrong`);
      const wrongKeyText = await wrongKey.text();
      expect(wrongKey.status).toBe(403);
      expect(wrongKey.headers.get('set-cookie')).toBeNull();
      for (const text of [crossSiteText, wrongKeyText]) {
        expect(text).not.toContain(ownerKey);
        expect(text).not.toContain(repo);
        expect(text.toLowerCase()).not.toContain('fatal:');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('unlock cookie is secure on https and cannot be reused across shares or after share expiry', async () => {
    const root = withTempDb();
    try {
      const first = createRepoWithCommits(root, 101);
      const secondRoot = join(root, 'second');
      mkdirSync(secondRoot);
      const second = createRepoWithCommits(secondRoot, 6);
      const firstToken = addDirAuthorization(first.repo, 60, []).token;
      const secondToken = addDirAuthorization(second.repo, 60, []).token;

      const unlock = await unlockGitHistory(firstToken, getOwnerKey(), {}, 'https://drop.example');
      expect(unlock.status).toBe(200);
      const setCookie = unlock.headers.get('set-cookie') || '';
      expect(setCookie).toContain('Secure');
      const cookie = cookieHeader(unlock);

      const firstExpanded = await app.request(`/d/${firstToken}/api/git/commits`, {
        headers: { Cookie: cookie },
      });
      expect((await firstExpanded.json() as any).limit).toBe(100);

      const secondLocked = await app.request(`/d/${secondToken}/api/git/commits`, {
        headers: { Cookie: cookie },
      });
      const secondLockedJson = await secondLocked.json() as any;
      expect(secondLocked.status).toBe(200);
      expect(secondLockedJson.limit).toBe(5);
      expect(secondLockedJson.commits).toHaveLength(5);

      getDb().query('UPDATE dir_authorizations SET expires_at = ? WHERE token = ?').run(Date.now() / 1000 - 1, firstToken);
      const expired = await app.request(`/d/${firstToken}/api/git/commits`, {
        headers: { Cookie: cookie },
      });
      expect(expired.status).toBe(403);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);

  test('allows diffs for the latest five commits and rejects older or invalid shas', async () => {
    const root = withTempDb();
    try {
      const { repo, shas } = createRepoWithCommits(root, 6);
      const token = addDirAuthorization(repo, 60, []).token;

      const latest = await app.request(`/d/${token}/api/git/commit/${shas[0]}`);
      const latestJson = await latest.json() as any;
      expect(latest.status).toBe(200);
      expect(latestJson.commit.sha).toBe(shas[0]);
      expect(latestJson.commit.short_sha).toBe(shas[0].slice(0, 7));
      expect(latestJson.diff_html).toContain('commit 6');
      expect(latestJson.diff_html).toContain('note.txt');

      const latestByPrefix = await app.request(`/d/${token}/api/git/commit/${shas[0].slice(0, 12)}`);
      expect(latestByPrefix.status).toBe(200);

      const sixth = await app.request(`/d/${token}/api/git/commit/${shas[5]}`);
      expect(sixth.status).toBe(403);

      const invalid = await app.request(`/d/${token}/api/git/commit/not-a-sha`);
      expect(invalid.status).toBe(404);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('escapes commit subjects in API responses and diff html', async () => {
    const root = withTempDb();
    try {
      const repo = join(root, 'repo-xss');
      mkdirSync(repo);
      git(['init'], repo);
      git(['config', 'core.hooksPath', '/dev/null'], repo);
      git(['config', 'user.email', 'test@example.com'], repo);
      git(['config', 'user.name', 'Test User'], repo);
      writeFileSync(join(repo, 'note.txt'), 'hello\n');
      git(['add', 'note.txt'], repo);
      git(['commit', '-m', '<img src=x onerror=alert(1)>'], repo);
      const sha = git(['rev-parse', 'HEAD'], repo);
      const token = addDirAuthorization(repo, 60, []).token;

      const commits = await app.request(`/d/${token}/api/git/commits`);
      const commitsJson = await commits.json() as any;
      expect(commits.status).toBe(200);
      expect(commitsJson.commits[0].subject).toBe('<img src=x onerror=alert(1)>');

      const diff = await app.request(`/d/${token}/api/git/commit/${sha}`);
      const diffJson = await diff.json() as any;
      expect(diff.status).toBe(200);
      expect(diffJson.commit.subject).toBe('<img src=x onerror=alert(1)>');
      expect(diffJson.diff_html).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(diffJson.diff_html).not.toContain('<img src=x onerror=alert(1)>');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('does not leak contents of excluded files through commit diffs', async () => {
    const root = withTempDb();
    try {
      const repo = join(root, 'repo-excl');
      mkdirSync(repo);
      git(['init'], repo);
      git(['config', 'core.hooksPath', '/dev/null'], repo);
      git(['config', 'user.email', 'test@example.com'], repo);
      git(['config', 'user.name', 'Test User'], repo);
      const SECRET = 'SUPER_SECRET_TOKEN_abc123';
      // Root commit needs a parent for diff-tree to report files, so seed first.
      writeFileSync(join(repo, 'README.md'), 'readme\n');
      git(['add', 'README.md'], repo);
      git(['commit', '-m', 'init'], repo);
      writeFileSync(join(repo, 'note.txt'), 'hello\n');
      writeFileSync(join(repo, '.env'), `API_KEY=${SECRET}\n`);
      git(['add', 'note.txt', '.env'], repo);
      git(['commit', '-m', 'add visible and hidden files'], repo);
      const sha = git(['rev-parse', 'HEAD'], repo);

      // Share with the default hidden-file exclusion applied.
      const token = addDirAuthorization(repo, 60, ['.*']).token;

      const diff = await app.request(`/d/${token}/api/git/commit/${sha}`);
      const diffJson = await diff.json() as any;
      expect(diff.status).toBe(200);
      // Visible file is shown; excluded dotfile and its secret are not.
      expect(diffJson.diff_html).toContain('note.txt');
      expect(diffJson.diff_html).not.toContain('.env');
      expect(diffJson.diff_html).not.toContain(SECRET);
      expect(JSON.stringify(diffJson)).not.toContain(SECRET);
      expect(diffJson.file_count).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
