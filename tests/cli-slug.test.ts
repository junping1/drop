import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { closeDb } from '../src/db/index.js';
import { CONFIG_PATH, PID_PATH } from '../src/shared/constants.js';

let oldPid: string | null = null;
let oldConfig: string | null = null;

beforeEach(() => {
  mkdirSync(dirname(PID_PATH), { recursive: true });
  oldPid = existsSync(PID_PATH) ? readFileSync(PID_PATH, 'utf-8') : null;
  oldConfig = existsSync(CONFIG_PATH) ? readFileSync(CONFIG_PATH, 'utf-8') : null;
  writeFileSync(PID_PATH, String(process.pid));
  writeFileSync(CONFIG_PATH, '{}\n');
});

afterEach(() => {
  if (oldPid === null) rmSync(PID_PATH, { force: true });
  else writeFileSync(PID_PATH, oldPid);
  if (oldConfig === null) rmSync(CONFIG_PATH, { force: true });
  else writeFileSync(CONFIG_PATH, oldConfig);
  closeDb();
  delete process.env.DROP_DB;
});

function testEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env = { ...process.env, ...extra };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_PREFIX;
  return env;
}

function runDrop(args: string[], env: Record<string, string>) {
  return Bun.spawnSync(['bun', 'src/cli/index.ts', ...args], {
    cwd: process.cwd(),
    env: testEnv(env),
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

function runGit(args: string[], cwd: string) {
  return Bun.spawnSync(['git', ...args], { cwd, env: testEnv() });
}

describe('CLI --slug', () => {
  test('allow emits slug URL and non-json guessable bearer warning', () => {
    const root = mkdtempSync(join(tmpdir(), 'drop-cli-slug-'));
    try {
      const file = join(root, 'file.txt');
      writeFileSync(file, 'hello');
      const env = { DROP_DB: join(root, 'drop.db') };

      const jsonRun = runDrop(['allow', file, '--slug', 'My_File', '--json'], env);
      expect(jsonRun.exitCode).toBe(0);
      const payload = JSON.parse(jsonRun.stdout.toString());
      expect(payload.slug).toBe('my_file');
      expect(payload.url).toBe('http://localhost:17173/f/my_file');
      expect(payload.token).toMatch(/^[0-9a-f]{32,}$/);

      const warnRun = runDrop(['allow', file, '--slug', 'other-file'], env);
      expect(warnRun.exitCode).toBe(0);
      expect(warnRun.stdout.toString()).toContain('/f/other-file');
      expect(warnRun.stderr.toString()).toContain('guessable bearer URL');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('share and allow-git emit slug URLs', () => {
    const root = mkdtempSync(join(tmpdir(), 'drop-cli-slug-git-'));
    try {
      const env = { DROP_DB: join(root, 'drop.db') };
      const shareRun = runDrop(['share', '--content', 'hi', '--slug', 'note-slug', '--json'], env);
      expect(shareRun.exitCode).toBe(0);
      expect(JSON.parse(shareRun.stdout.toString()).url).toBe('http://localhost:17173/f/note-slug');

      const repo = join(root, 'repo');
      mkdirSync(repo);
      expect(runGit(['init'], repo).exitCode).toBe(0);
      expect(runGit(['config', 'user.email', 't@example.com'], repo).exitCode).toBe(0);
      expect(runGit(['config', 'user.name', 'Test'], repo).exitCode).toBe(0);
      writeFileSync(join(repo, 'README.md'), 'hi');
      expect(runGit(['add', 'README.md'], repo).exitCode).toBe(0);
      expect(runGit(['commit', '-m', 'init'], repo).exitCode).toBe(0);
      const hash = runGit(['rev-parse', 'HEAD'], repo).stdout.toString().trim();

      const gitRun = runDrop(['allow-git', repo, hash, '--slug', 'commit-slug', '--json'], env);
      expect(gitRun.exitCode).toBe(0);
      expect(JSON.parse(gitRun.stdout.toString()).url).toBe('http://localhost:17173/git/commit-slug');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('invalid slug failure does not leave a new authorization behind', () => {
    const root = mkdtempSync(join(tmpdir(), 'drop-cli-invalid-slug-'));
    try {
      const file = join(root, 'file.txt');
      writeFileSync(file, 'hello');
      const env = { DROP_DB: join(root, 'drop.db') };

      const failed = runDrop(['allow', file, '--slug', 'bad slug', '--json'], env);
      expect(failed.exitCode).toBe(1);
      const listRun = runDrop(['list', '--json'], env);
      expect(JSON.parse(listRun.stdout.toString())).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('duplicate slug failure does not create an extra authorization', () => {
    const root = mkdtempSync(join(tmpdir(), 'drop-cli-duplicate-slug-'));
    try {
      const fileA = join(root, 'a.txt');
      const fileB = join(root, 'b.txt');
      writeFileSync(fileA, 'a');
      writeFileSync(fileB, 'b');
      const env = { DROP_DB: join(root, 'drop.db') };
      expect(runDrop(['allow', fileA, '--slug', 'dupe-slug', '--json'], env).exitCode).toBe(0);

      const failed = runDrop(['allow', fileB, '--slug', 'dupe-slug', '--json'], env);
      expect(failed.exitCode).toBe(1);
      const items = JSON.parse(runDrop(['list', '--json'], env).stdout.toString());
      expect(items).toHaveLength(1);
      expect(items[0].path).toBe(fileA);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('list json includes slug and slug URL, and revoke accepts slug', () => {
    const root = mkdtempSync(join(tmpdir(), 'drop-cli-list-revoke-slug-'));
    try {
      const file = join(root, 'file.txt');
      writeFileSync(file, 'hello');
      const env = { DROP_DB: join(root, 'drop.db') };
      expect(runDrop(['allow', file, '--slug', 'list-slug', '--json'], env).exitCode).toBe(0);

      const listRun = runDrop(['list', '--json'], env);
      expect(listRun.exitCode).toBe(0);
      const items = JSON.parse(listRun.stdout.toString());
      expect(items[0].slug).toBe('list-slug');
      expect(items[0].url).toBe('http://localhost:17173/f/list-slug');

      const revokeRun = runDrop(['revoke', 'list-slug'], env);
      expect(revokeRun.exitCode).toBe(0);
      expect(revokeRun.stdout.toString()).toContain('Revoked: list-slug');
      expect(JSON.parse(runDrop(['list', '--json'], env).stdout.toString())).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
