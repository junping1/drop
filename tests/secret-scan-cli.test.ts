import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { closeDb, getDb } from '../src/db/index.js';

const CLI = join(import.meta.dir, '..', 'src', 'cli', 'index.ts');
const STRIPE_KEY = 'sk_live_' + 'e'.repeat(24);
const GOOGLE_KEY = 'AIza' + 'f'.repeat(35);

function cleanEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('GIT_')) env[key] = value;
  }
  return { ...env, ...overrides };
}

function makeEnv(root: string): Record<string, string> {
  return cleanEnv({
    HOME: root,
    DROP_DB: join(root, 'drop.db'),
    NO_COLOR: '1',
  });
}

function runDrop(args: string[], env: Record<string, string>, stdin?: string) {
  return Bun.spawnSync([process.execPath, CLI, ...args], {
    env,
    stdin: stdin ? new TextEncoder().encode(stdin) : undefined,
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

function markDaemonRunning(root: string): void {
  const stateDir = join(root, '.drop');
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, 'drop.pid'), String(process.pid));
}

describe('secret scan CLI integration', () => {
  test('drop allow blocks high-confidence secrets before authorization or daemon startup', () => {
    const root = mkdtempSync(join(tmpdir(), 'drop-secret-cli-'));
    try {
      const env = makeEnv(root);
      const file = join(root, 'app.env');
      writeFileSync(file, `STRIPE_SECRET=${STRIPE_KEY}\n`);

      const result = runDrop(['allow', file, '--json'], env);

      expect(result.exitCode).toBe(1);
      const payload = JSON.parse(result.stdout.toString());
      expect(payload.error).toContain('Secret scan blocked');
      expect(payload.secret_scan.blocked).toBe(true);
      expect(payload.secret_scan.findings_count).toBe(1);
      expect(payload.secret_scan.findings[0]).toEqual(expect.objectContaining({
        path: file,
        line: 1,
        rule_id: 'stripe-live-key',
        severity: 'high',
      }));
      expect(JSON.stringify(payload)).not.toContain(STRIPE_KEY);
      expect(existsSync(join(root, '.drop', 'drop.pid'))).toBe(false);

      closeDb();
      process.env.DROP_DB = env.DROP_DB;
      const db = getDb();
      expect(db.query('SELECT COUNT(*) as cnt FROM authorizations').get()).toEqual({ cnt: 0 });
    } finally {
      closeDb();
      delete process.env.DROP_DB;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('drop allow --force scans but creates authorization and reports forced metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'drop-secret-force-'));
    try {
      const env = makeEnv(root);
      markDaemonRunning(root);
      const file = join(root, 'google.txt');
      writeFileSync(file, `key=${GOOGLE_KEY}`);

      const result = runDrop(['allow', file, '--force', '--json'], env);

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout.toString());
      expect(payload.url).toContain('/f/');
      expect(payload.secret_scan).toEqual(expect.objectContaining({
        forced: true,
        findings_count: 1,
      }));
      expect(payload.secret_scan.findings[0].rule_id).toBe('google-api-key');
      expect(JSON.stringify(payload)).not.toContain(GOOGLE_KEY);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('drop share blocks secret content before writing stdin temp files', () => {
    const root = mkdtempSync(join(tmpdir(), 'drop-secret-share-'));
    try {
      const env = makeEnv(root);

      const result = runDrop(['share', '--json', '--title', 'stdin-secret'], env, `token=${STRIPE_KEY}`);

      expect(result.exitCode).toBe(1);
      const payload = JSON.parse(result.stdout.toString());
      expect(payload.secret_scan.blocked).toBe(true);
      expect(JSON.stringify(payload)).not.toContain(STRIPE_KEY);
      const sharesDir = join(root, '.drop', 'shares');
      expect(existsSync(sharesDir) ? readdirSync(sharesDir) : []).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });


  test('drop allow-git blocks secret commits before authorization or daemon startup', () => {
    const root = mkdtempSync(join(tmpdir(), 'drop-secret-cli-git-'));
    try {
      const env = makeEnv(root);
      const repo = join(root, 'repo');
      mkdirSync(repo);
      const git = (args: string[]) => {
        const result = Bun.spawnSync(['git', ...args], { cwd: repo, env: cleanEnv(), stdout: 'pipe', stderr: 'pipe' });
        if (result.exitCode !== 0) throw new Error(result.stderr.toString());
      };
      git(['init']);
      git(['config', 'core.hooksPath', '/dev/null']);
      git(['config', 'user.email', 'test@example.com']);
      git(['config', 'user.name', 'Test User']);
      writeFileSync(join(repo, 'README.md'), 'safe');
      git(['add', 'README.md']);
      git(['commit', '-m', 'initial']);
      writeFileSync(join(repo, 'secret.txt'), `key=${GOOGLE_KEY}`);
      git(['add', 'secret.txt']);
      git(['commit', '-m', 'add secret']);
      const commit = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: repo, env: cleanEnv() }).stdout.toString().trim();

      const result = runDrop(['allow-git', repo, commit, '--json'], env);

      expect(result.exitCode).toBe(1);
      const payload = JSON.parse(result.stdout.toString());
      expect(payload.secret_scan.blocked).toBe(true);
      expect(payload.secret_scan.findings[0]).toEqual(expect.objectContaining({
        path: 'secret.txt',
        line: 1,
        rule_id: 'google-api-key',
      }));
      expect(JSON.stringify(payload)).not.toContain(GOOGLE_KEY);
      expect(existsSync(join(root, '.drop', 'drop.pid'))).toBe(false);

      closeDb();
      process.env.DROP_DB = env.DROP_DB;
      const db = getDb();
      expect(db.query('SELECT COUNT(*) as cnt FROM git_authorizations').get()).toEqual({ cnt: 0 });
    } finally {
      closeDb();
      delete process.env.DROP_DB;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('--no-secret-scan skips scanning and reports disabled metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'drop-secret-disabled-'));
    try {
      const env = makeEnv(root);
      markDaemonRunning(root);
      const file = join(root, 'app.env');
      writeFileSync(file, `STRIPE_SECRET=${STRIPE_KEY}\n`);

      const result = runDrop(['allow', file, '--no-secret-scan', '--json'], env);

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout.toString());
      expect(payload.secret_scan).toEqual({ disabled: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('--force and --no-secret-scan cannot be used together', () => {
    const root = mkdtempSync(join(tmpdir(), 'drop-secret-conflict-'));
    try {
      const env = makeEnv(root);
      const file = join(root, 'safe.txt');
      writeFileSync(file, 'hello');

      const result = runDrop(['allow', file, '--force', '--no-secret-scan', '--json'], env);

      expect(result.exitCode).toBe(1);
      const payload = JSON.parse(result.stdout.toString());
      expect(payload.error).toContain('--force and --no-secret-scan cannot be used together');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
