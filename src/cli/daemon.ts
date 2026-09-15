import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { cleanupExpiredShares } from '../db/cleanup.js';
import { hasActiveAuthorizations } from '../db/authorizations.js';
import { DEFAULT_HOST, LOG_PATH, PID_PATH, ensureStateDir } from '../shared/constants.js';

export function readPid(pidPath: string = PID_PATH): number | null {
  if (!existsSync(pidPath)) return null;
  const content = readFileSync(pidPath, 'utf-8').trim();
  if (!content) return null;
  return parseInt(content, 10);
}

export function writePid(pidPath: string = PID_PATH): void {
  mkdirSync(dirname(pidPath), { recursive: true });
  writeFileSync(pidPath, String(process.pid));
}

/**
 * Delete the pid file only if it still belongs to `ownPid` (defaults to the
 * current process). This prevents a process that fails to become the daemon
 * (for example because the port is already bound) from deleting the pid
 * file that belongs to the real, already-running daemon.
 *
 * `pidPath` defaults to the real daemon pid path and is overridable so tests
 * can exercise this against an isolated temp file instead of ~/.drop/drop.pid.
 */
export function removePid(ownPid: number = process.pid, pidPath: string = PID_PATH): void {
  if (!existsSync(pidPath)) return;
  try {
    const content = readFileSync(pidPath, 'utf-8').trim();
    if (content === String(ownPid)) {
      unlinkSync(pidPath);
    }
  } catch {
    /* ignore */
  }
}

export function isDaemonRunning(): boolean {
  const pid = readPid();
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    if (e.code === 'ESRCH') {
      removePid(pid);
      return false;
    }
    return true;
  }
}

export function buildDaemonArgs(executable: string, scriptPath: string | undefined, port: number, host: string): string[] {
  const base = scriptPath && scriptPath.endsWith('.ts')
    ? [executable, scriptPath]
    : [executable];
  return [...base, 'serve', '--port', String(port), '--host', host];
}

function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\"'\"'") + "'";
}

/**
 * Build the `sh -c` command that launches the daemon detached from the parent's
 * controlling terminal and stdin. `nohup` + `< /dev/null` ensure the compiled
 * binary keeps running after the foreground `drop` command exits.
 */
export function buildDaemonShellCommand(args: string[], logPath: string): string {
  return `nohup ${args.map(shellQuote).join(' ')} >> ${shellQuote(logPath)} 2>&1 < /dev/null &`;
}

async function waitForHealth(port: number, timeoutMs = 1500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      if (res.ok) return true;
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

export async function startDaemon(port: number, host = DEFAULT_HOST): Promise<void> {
  ensureStateDir();
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  // In Bun source mode process.execPath is the Bun runtime and process.argv[1]
  // is the TypeScript entrypoint. In a compiled binary process.execPath is the
  // binary itself, while process.argv[1] is usually the first CLI argument
  // (for example "allow"). Use execPath so auto-start does not accidentally
  // spawn `bun serve`, which Bun interprets as a package script.
  const args = buildDaemonArgs(process.execPath, process.argv[1], port, host);
  const shellCommand = buildDaemonShellCommand(args, LOG_PATH);

  const proc = Bun.spawn(['sh', '-c', shellCommand], {
    stdout: 'ignore',
    stderr: 'ignore',
    stdin: 'ignore',
  });
  await proc.exited;

  if (await waitForHealth(port)) {
    console.error(`Daemon started on port ${port}`);
  } else {
    console.error(`Warning: daemon did not become healthy, check ${LOG_PATH}`);
  }
}

export function stopDaemon(): boolean {
  const pid = readPid();
  if (pid === null) return false;
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch (e: any) {
    if (e.code === 'ESRCH') {
      removePid(pid);
      return false;
    }
    return false;
  }
}

export function startCleanupTimer(): void {
  const cleanupIntervalMs = 60_000;
  setInterval(() => {
    cleanupExpiredShares();
    if (!hasActiveAuthorizations()) {
      console.error('All authorizations expired, shutting down.');
      removePid();
      process.exit(0);
    }
  }, cleanupIntervalMs);
}
