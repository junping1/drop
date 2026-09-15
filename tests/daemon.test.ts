import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildDaemonArgs, buildDaemonShellCommand, removePid } from '../src/cli/daemon.js';

describe('daemon command construction', () => {
  test('uses bun plus script path in source mode', () => {
    expect(buildDaemonArgs('/usr/bin/bun', '/repo/src/cli/index.ts', 17173, '0.0.0.0')).toEqual([
      '/usr/bin/bun', '/repo/src/cli/index.ts', 'serve', '--port', '17173', '--host', '0.0.0.0',
    ]);
  });

  test('uses compiled binary directly in binary mode', () => {
    expect(buildDaemonArgs('/Users/me/.local/bin/drop', undefined, 17173, '0.0.0.0')).toEqual([
      '/Users/me/.local/bin/drop', 'serve', '--port', '17173', '--host', '0.0.0.0',
    ]);
  });

  test('uses process.execPath for Bun compiled binaries', () => {
    expect(buildDaemonArgs('/Users/me/.local/bin/drop', '/$bunfs/root/drop', 17173, '0.0.0.0')).toEqual([
      '/Users/me/.local/bin/drop', 'serve', '--port', '17173', '--host', '0.0.0.0',
    ]);
  });

  test('uses compiled binary directly even when argv[1] is a subcommand', () => {
    expect(buildDaemonArgs('/Users/me/.local/bin/drop', 'allow', 17173, '0.0.0.0')).toEqual([
      '/Users/me/.local/bin/drop', 'serve', '--port', '17173', '--host', '0.0.0.0',
    ]);
  });
});

describe('daemon shell command', () => {
  const args = ['/Users/me/.local/bin/drop', 'serve', '--port', '17173', '--host', '0.0.0.0'];

  test('detaches the daemon from terminal and stdin', () => {
    const cmd = buildDaemonShellCommand(args, '/tmp/drop.log');
    expect(cmd.startsWith('nohup ')).toBe(true);
    expect(cmd).toContain('< /dev/null'); // detach stdin
    expect(cmd).toContain('>> ');          // append to log
    expect(cmd).toContain('2>&1');         // redirect stderr
    expect(cmd.trimEnd().endsWith('&')).toBe(true); // background
  });

  test('shell-quotes the executable, args, and log path', () => {
    const cmd = buildDaemonShellCommand(args, "/tmp/odd dir/drop.log");
    expect(cmd).toContain("'/Users/me/.local/bin/drop' 'serve' '--port' '17173' '--host' '0.0.0.0'");
    expect(cmd).toContain("'/tmp/odd dir/drop.log'");
  });

  test('actually keeps a backgrounded process alive after the parent shell exits', async () => {
    const root = process.env.TMPDIR || '/tmp';
    const marker = `${root}/drop-daemon-test-${process.pid}.txt`;
    // Simulate the detached launch: a child that outlives the `sh -c` invocation.
    const cmd = buildDaemonShellCommand(['sh', '-c', `sleep 0.5; echo alive > ${marker}`], `${root}/drop-daemon-test.log`);
    const proc = Bun.spawn(['sh', '-c', cmd], { stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' });
    await proc.exited; // parent returns immediately; child keeps running
    await new Promise((r) => setTimeout(r, 900));
    const { existsSync, rmSync } = await import('fs');
    const survived = existsSync(marker);
    if (survived) rmSync(marker, { force: true });
    expect(survived).toBe(true);
  });
});

describe('removePid ownership check', () => {
  // Uses an isolated temp pid file (via removePid's optional pidPath
  // parameter) rather than the real ~/.drop/drop.pid, so these in-process
  // tests never touch the state of a real running daemon.
  let root: string;
  let pidPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'drop-removepid-'));
    pidPath = join(root, 'drop.pid');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('does not delete a pid file that belongs to another process', () => {
    writeFileSync(pidPath, String(process.pid + 1));
    removePid(process.pid, pidPath);
    expect(existsSync(pidPath)).toBe(true);
    expect(readFileSync(pidPath, 'utf-8').trim()).toBe(String(process.pid + 1));
  });

  test('deletes the pid file when it matches the given pid', () => {
    writeFileSync(pidPath, String(process.pid));
    removePid(process.pid, pidPath);
    expect(existsSync(pidPath)).toBe(false);
  });

  test('defaults to the current process pid when no ownPid argument is given', () => {
    writeFileSync(pidPath, String(process.pid));
    removePid(undefined, pidPath);
    expect(existsSync(pidPath)).toBe(false);
  });
});

describe('serve bind failure does not clobber the daemon pid file', () => {
  test('exits non-zero and leaves the pre-existing pid file untouched', async () => {
    const root = mkdtempSync(join(tmpdir(), 'drop-serve-bind-'));
    let blocker: ReturnType<typeof Bun.serve> | undefined;
    try {
      // Occupy an ephemeral port so the child `serve` invocation fails to bind.
      blocker = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('ok') });
      const port = blocker.port;

      const stateDir = join(root, '.drop');
      mkdirSync(stateDir, { recursive: true });
      const pidPath = join(stateDir, 'drop.pid');
      writeFileSync(pidPath, '999999');

      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined && !key.startsWith('GIT_')) env[key] = value;
      }
      env.HOME = root;

      const proc = Bun.spawnSync(
        ['bun', 'src/cli/index.ts', 'serve', '--port', String(port), '--host', '127.0.0.1', '--foreground'],
        { cwd: process.cwd(), env, stdout: 'pipe', stderr: 'pipe' },
      );

      expect(proc.exitCode).not.toBe(0);
      expect(existsSync(pidPath)).toBe(true);
      expect(readFileSync(pidPath, 'utf-8').trim()).toBe('999999');
    } finally {
      blocker?.stop(true);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
