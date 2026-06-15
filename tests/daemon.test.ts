import { describe, expect, test } from 'bun:test';
import { buildDaemonArgs, buildDaemonShellCommand } from '../src/cli/daemon.js';

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
