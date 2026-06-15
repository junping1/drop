import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { closeDb, getDb } from '../src/db/index.js';
import { addAuthorization, removeAuthorization } from '../src/db/authorizations.js';
import { addDirAuthorization } from '../src/db/dir-authorizations.js';
import { app } from '../src/server/index.js';

function withTempDb(): string {
  closeDb();
  const root = mkdtempSync(join(tmpdir(), 'drop-access-routes-'));
  process.env.DROP_DB = join(root, 'drop.db');
  return root;
}

function cleanGitEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_') && value !== undefined) env[key] = value;
  }
  return env;
}

function runGit(args: string[], cwd: string) {
  return Bun.spawnSync(['git', ...args], { cwd, env: cleanGitEnv() });
}

function eventRows(): any[] {
  return getDb().query('SELECT token, event_type, outcome, referer_origin, target_path_hash, target_ext FROM access_events ORDER BY id').all() as any[];
}

afterEach(() => {
  closeDb();
  delete process.env.DROP_DB;
});

describe('access logging routes', () => {
  test('records successful file, directory, raw, api and git accesses with expected event types', async () => {
    const root = withTempDb();
    try {
      const file = join(root, 'file.txt');
      writeFileSync(file, 'hello');
      const dir = join(root, 'dir');
      mkdirSync(dir);
      writeFileSync(join(dir, 'note.md'), '# note');
      const fileToken = addAuthorization(file, 60).token;
      const dirToken = addDirAuthorization(dir, 60, []).token;
      const repo = join(root, 'repo');
      mkdirSync(repo);
      runGit(['init'], repo);
      runGit(['config', 'user.email', 'test@example.com'], repo);
      runGit(['config', 'user.name', 'Test User'], repo);
      writeFileSync(join(repo, 'tracked.txt'), 'hello');
      runGit(['add', 'tracked.txt'], repo);
      runGit(['commit', '-m', 'initial'], repo);
      const commit = runGit(['rev-parse', 'HEAD'], repo).stdout.toString().trim();
      const now = Date.now() / 1000;
      getDb().query('INSERT INTO git_authorizations (token, repo_path, commit_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
        .run('git-token', repo, commit, now, now + 60);

      await app.fetch(new Request(`http://drop.test/f/${fileToken}`, { headers: { 'user-agent': 'curl/8.0', referer: 'https://ref.example/a?b=c' } }));
      await app.fetch(new Request(`http://drop.test/d/${dirToken}`));
      await app.fetch(new Request(`http://drop.test/d/${dirToken}/note.md`));
      await app.fetch(new Request(`http://drop.test/d/${dirToken}/raw?path=note.md&secret=hidden`));
      await app.fetch(new Request(`http://drop.test/d/${dirToken}/api/tree`));
      await app.fetch(new Request(`http://drop.test/d/${dirToken}/api/file?path=note.md`));
      await app.fetch(new Request('http://drop.test/git/git-token'));
      await app.fetch(new Request(`http://drop.test/live/${dirToken}/poll?since=0`));
      await app.fetch(new Request('http://drop.test/dashboard'));
      await app.fetch(new Request('http://drop.test/verify'));
      await app.fetch(new Request('http://drop.test/owner/auth'));

      const rows = eventRows();
      expect(rows.map((r) => r.event_type)).toEqual([
        'page_view',
        'page_view',
        'page_view',
        'raw_view',
        'api_tree',
        'api_preview',
        'page_view',
      ]);
      expect(rows[0].referer_origin).toBe('https://ref.example');
      expect(rows[3].target_path_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[3].target_ext).toBe('.md');
      expect(JSON.stringify(rows)).not.toContain('secret=hidden');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('revoke deletes access events for the token', () => {
    const root = withTempDb();
    try {
      const file = join(root, 'file.txt');
      writeFileSync(file, 'hello');
      const token = addAuthorization(file, 60).token;
      getDb().query("INSERT INTO access_events (token, share_type, event_type, outcome, created_at) VALUES (?, 'file', 'page_view', 'success', ?)").run(token, Date.now() / 1000);

      expect(removeAuthorization(token)).toBe(true);
      expect(eventRows()).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
