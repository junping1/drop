import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DEFAULT_HOST } from '../src/shared/constants.js';

const CLI = join(import.meta.dir, '..', 'src', 'cli', 'index.ts');

function cleanEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('GIT_')) env[key] = value;
  }
  return { ...env, ...overrides };
}

function makeEnv(root: string, extra: Record<string, string> = {}): Record<string, string> {
  return cleanEnv({
    HOME: root,
    DROP_DB: join(root, 'drop.db'),
    NO_COLOR: '1',
    ...extra,
  });
}

function runDrop(args: string[], env: Record<string, string>) {
  return Bun.spawnSync([process.execPath, CLI, ...args], {
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

function randomEphemeralPort(): number {
  // Stay well clear of the real daemon's ports (17173/17174) and other
  // fixed ports used elsewhere in the test suite.
  return 21000 + Math.floor(Math.random() * 4000);
}

async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('condition not met before timeout');
}

let spawnedPid: number | null = null;
let root: string | null = null;

afterEach(() => {
  if (spawnedPid !== null) {
    try { process.kill(spawnedPid, 'SIGTERM'); } catch { /* already gone */ }
    spawnedPid = null;
  }
  if (root !== null) {
    rmSync(root, { recursive: true, force: true });
    root = null;
  }
});

describe('DEFAULT_HOST', () => {
  test('is loopback', () => {
    expect(DEFAULT_HOST).toBe('127.0.0.1');
  });
});

describe('auto-started daemon host binding', () => {
  test('binds to loopback by default', async () => {
    root = mkdtempSync(join(tmpdir(), 'drop-cli-host-'));
    const env = makeEnv(root);
    const file = join(root, 'file.txt');
    writeFileSync(file, 'hello');
    const port = randomEphemeralPort();

    const result = runDrop(['allow', file, '--port', String(port), '--json'], env);
    expect(result.exitCode).toBe(0);

    const pidPath = join(root, '.drop', 'drop.pid');
    const logPath = join(root, '.drop', 'drop.log');
    await waitFor(() => existsSync(pidPath));
    spawnedPid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);

    await waitFor(() => existsSync(logPath) && readFileSync(logPath, 'utf-8').includes('drop serving on'));
    const log = readFileSync(logPath, 'utf-8');
    expect(log).toContain(`drop serving on http://127.0.0.1:${port}`);
  });

  test('binds to configured host when host config is set', async () => {
    root = mkdtempSync(join(tmpdir(), 'drop-cli-host-cfg-'));
    const env = makeEnv(root);
    mkdirSync(join(root, '.drop'), { recursive: true });
    const configSet = runDrop(['config', 'set', 'host', '0.0.0.0'], env);
    expect(configSet.exitCode).toBe(0);

    const file = join(root, 'file.txt');
    writeFileSync(file, 'hello');
    const port = randomEphemeralPort();

    const result = runDrop(['allow', file, '--port', String(port), '--json'], env);
    expect(result.exitCode).toBe(0);

    const pidPath = join(root, '.drop', 'drop.pid');
    const logPath = join(root, '.drop', 'drop.log');
    await waitFor(() => existsSync(pidPath));
    spawnedPid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);

    await waitFor(() => existsSync(logPath) && readFileSync(logPath, 'utf-8').includes('drop serving on'));
    const log = readFileSync(logPath, 'utf-8');
    expect(log).toContain(`drop serving on http://0.0.0.0:${port}`);
  });
});
