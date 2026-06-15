#!/usr/bin/env bun

import { Command } from 'commander';
import { resolve } from 'path';
import { existsSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { randomBytes } from 'crypto';

import {
  DEFAULT_PORT, DEFAULT_HOST, DEFAULT_TTL, DIR_DEFAULT_TTL,
  DEFAULT_EXCLUDES, SHARES_DIR, SHARE_TYPE_MAP, MAX_SHARE_SIZE,
  STATUS_ACTIVE, STATUS_EXPIRED,
  ensureStateDir,
} from '../shared/constants.js';
import { loadConfig, saveConfig, getOwnerKey } from '../shared/config.js';
import { displayPath } from '../shared/utils.js';
import { addAuthorization, removeAuthorization, listAuthorizations } from '../db/authorizations.js';
import { addDirAuthorization, listDirAuthorizations } from '../db/dir-authorizations.js';
import { addGitAuthorization } from '../db/git-authorizations.js';
import { getDb } from '../db/index.js';
import { buildUrl } from './url.js';
import { outputShareError, outputShareResult } from './output.js';
import { VALID_CONFIG_KEYS, applyConfigValue, getConfigValue, isValidConfigKey } from './config.js';
import { isDaemonRunning, readPid, removePid, startCleanupTimer, startDaemon, stopDaemon, writePid } from './daemon.js';
import { scanGitCommit, scanPath, scanText, type SecretScanResult } from '../shared/secret-scan.js';

interface SecretScanCliOptions {
  force?: boolean;
  secretScan?: boolean;
  json?: boolean;
}

type SecretScanSuccessMetadata =
  | { disabled: true }
  | { forced: true; findings_count: number; findings: SecretScanResult['findings'] }
  | undefined;

function writeCliError(opts: { json?: boolean }, message: string, secretScan?: Record<string, unknown>): never {
  if (opts.json) {
    const payload: Record<string, unknown> = { error: message };
    if (secretScan) payload.secret_scan = secretScan;
    console.log(JSON.stringify(payload));
  } else {
    console.error(message);
    if (secretScan?.findings) {
      console.error(JSON.stringify(secretScan, null, 2));
    }
  }
  process.exit(1);
}

function runSecretScanForCli(opts: SecretScanCliOptions, scan: () => SecretScanResult): SecretScanSuccessMetadata {
  if (opts.force && opts.secretScan === false) {
    writeCliError(opts, '--force and --no-secret-scan cannot be used together');
  }

  if (opts.secretScan === false) {
    return { disabled: true };
  }

  const result = scan();
  if (result.blocked && !opts.force) {
    writeCliError(opts, 'Secret scan blocked sharing because high-confidence secrets were found.', {
      blocked: true,
      findings_count: result.findings.length,
      findings: result.findings,
    });
  }

  if (opts.force) {
    return { forced: true, findings_count: result.findings.length, findings: result.findings };
  }

  return undefined;
}

function withSecretScanMetadata<T extends Record<string, unknown>>(payload: T, metadata: SecretScanSuccessMetadata): T & { secret_scan?: SecretScanSuccessMetadata } {
  if (!metadata) return payload;
  return { ...payload, secret_scan: metadata };
}

// --- CLI setup ---

const program = new Command();
program
  .name('drop')
  .description('drop — Share files, directories, and content via time-limited preview URLs.')
  .version('1.0.0');

// serve
program
  .command('serve')
  .description('Start the web server')
  .option('--port <port>', 'Port to listen on', String(DEFAULT_PORT))
  .option('--host <host>', 'Host to bind to', DEFAULT_HOST)
  .option('--foreground', 'Run in foreground (no auto-stop timer)', false)
  .option('--tunnel', 'Start a cloudflared Quick Tunnel', false)
  .action(async (opts) => {
    ensureStateDir();
    writePid();
    process.on('exit', removePid);
    process.on('SIGTERM', () => { removePid(); process.exit(0); });
    process.on('SIGINT', () => { removePid(); process.exit(0); });

    const port = parseInt(opts.port, 10);
    const host = opts.host;

    if (!opts.foreground) {
      const cfg = loadConfig();
      if (cfg.auto_stop) {
        startCleanupTimer();
      }
    }

    const { app } = await import('../server/index.js');
    console.log(`drop serving on http://${host}:${port} (pid ${process.pid})`);
    Bun.serve({
      port,
      hostname: host,
      fetch: app.fetch,
    });
  });

// allow
program
  .command('allow')
  .description('Share a file or directory via a time-limited preview URL')
  .argument('<path>', 'File or directory path to share')
  .option('--ttl <seconds>', 'Time-to-live in seconds')
  .option('--port <port>', 'Port for URL generation', String(DEFAULT_PORT))
  .option('--host <host>', 'Host for URL generation', 'localhost')
  .option('--head <lines>', 'Only show first N lines (files only)')
  .option('--tail <lines>', 'Only show last N lines (files only)')
  .option('--exclude <pattern...>', 'Additional exclude patterns for directory shares')
  .option('--live', 'Enable live preview (auto-refresh on file changes)', false)
  .option('--force', 'Continue even when secret scan finds high-confidence secrets', false)
  .option('--no-secret-scan', 'Skip secret scanning before creating authorization')
  .option('--json', 'Output result as JSON', false)
  .option('--qr', 'Print a terminal QR code to stderr', false)
  .action(async (path, opts) => {
    ensureStateDir();
    const absPath = resolve(path);
    const cfg = loadConfig();
    const port = cfg.port || parseInt(opts.port, 10);
    const host = opts.host;

    const isDir = existsSync(absPath) && statSync(absPath).isDirectory();
    const isFile = existsSync(absPath) && statSync(absPath).isFile();

    if (!isDir && !isFile) {
      if (opts.json) {
        console.log(JSON.stringify({ error: `Path not found: ${absPath}` }));
      } else {
        console.error(`Path not found: ${absPath}`);
      }
      process.exit(1);
    }

    const excludes = isDir ? [...(cfg.default_excludes || DEFAULT_EXCLUDES), ...(opts.exclude || [])] : [];
    const secretScan = runSecretScanForCli(opts, () => scanPath(absPath, { excludes }));

    if (isDir) {
      const ttl = opts.ttl ? parseInt(opts.ttl, 10) : (cfg.dir_default_ttl || DIR_DEFAULT_TTL);
      if (opts.head || opts.tail) {
        console.error('Warning: --head and --tail are ignored for directory shares');
      }
      const { token, dirname, isNew } = addDirAuthorization(absPath, ttl, excludes, opts.live);
      const url = buildUrl(cfg, 'd', token, port, host);
      const expiresAt = Date.now() / 1000 + ttl;

      outputShareResult(
        withSecretScanMetadata({ url, token, type: 'dir', path: absPath, ttl, expires_at: expiresAt, live: opts.live, is_new: isNew }, secretScan),
        {
          json: opts.json,
          qr: opts.qr,
          stderrMessages: [
            ...(!isNew ? ['(existing authorization extended)'] : []),
            ...(opts.live ? ['(live preview enabled)'] : []),
          ],
        },
      );

      if (!isDaemonRunning()) await startDaemon(port, DEFAULT_HOST);
    } else if (isFile) {
      const ttl = opts.ttl ? parseInt(opts.ttl, 10) : (cfg.file_ttl || DEFAULT_TTL);
      const { token, filename, isNew } = addAuthorization(path, ttl, opts.live);
      let url = buildUrl(cfg, 'f', token, port, host);
      const expiresAt = Date.now() / 1000 + ttl;

      const params: string[] = [];
      if (opts.head) params.push(`head=${opts.head}`);
      if (opts.tail) params.push(`tail=${opts.tail}`);
      if (params.length) url += '?' + params.join('&');

      outputShareResult(
        withSecretScanMetadata({ url, token, type: 'file', path: absPath, ttl, expires_at: expiresAt, live: opts.live, is_new: isNew }, secretScan),
        {
          json: opts.json,
          qr: opts.qr,
          stderrMessages: [
            ...(!isNew ? ['(existing authorization extended)'] : []),
            ...(opts.live ? ['(live preview enabled)'] : []),
          ],
        },
      );

      if (!isDaemonRunning()) await startDaemon(port, DEFAULT_HOST);
    }
  });

// share
program
  .command('share')
  .description('Share content from stdin or inline text as a temporary file')
  .option('--type <type>', 'Content type for rendering', 'text')
  .option('--content <text>', 'Inline content string to share')
  .option('--title <title>', 'Title for the shared content')
  .option('--ttl <seconds>', 'Time-to-live in seconds')
  .option('--port <port>', 'Port for URL generation', String(DEFAULT_PORT))
  .option('--host <host>', 'Host for URL generation', 'localhost')
  .option('--force', 'Continue even when secret scan finds high-confidence secrets', false)
  .option('--no-secret-scan', 'Skip secret scanning before creating authorization')
  .option('--json', 'Output result as JSON', false)
  .option('--qr', 'Print a terminal QR code to stderr', false)
  .action(async (opts) => {
    ensureStateDir();

    let text: string;
    if (opts.content != null) {
      text = opts.content;
    } else if (!process.stdin.isTTY) {
      // Read from stdin
      text = await new Response(Bun.stdin.stream()).text();
      if (text.length > MAX_SHARE_SIZE) {
        console.error(`Error: input exceeds ${MAX_SHARE_SIZE / (1024 * 1024)}MB limit`);
        process.exit(1);
      }
    } else {
      console.error('Error: provide --content or pipe data via stdin');
      console.error('  echo "content" | drop share --type markdown');
      process.exit(1);
    }

    const secretScan = runSecretScanForCli(opts, () => scanText(text, opts.title || '<stdin>'));

    mkdirSync(SHARES_DIR, { recursive: true });
    const ext = SHARE_TYPE_MAP[opts.type] || '.txt';
    const slug = opts.title ? opts.title.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40) : 'share';
    const filename = `${slug}_${randomBytes(4).toString('hex')}${ext}`;
    const filepath = resolve(SHARES_DIR, filename);
    writeFileSync(filepath, text);

    const cfg = loadConfig();
    const port = cfg.port || parseInt(opts.port, 10);
    const ttl = opts.ttl ? parseInt(opts.ttl, 10) : (cfg.file_ttl || DEFAULT_TTL);
    const { token, isNew } = addAuthorization(filepath, ttl);
    const url = buildUrl(cfg, 'f', token, port, opts.host);

    outputShareResult(
      withSecretScanMetadata({ url, token, type: opts.type, path: filepath, ttl, expires_at: Date.now() / 1000 + ttl }, secretScan),
      { json: opts.json, qr: opts.qr },
    );

    if (!isDaemonRunning()) await startDaemon(port, DEFAULT_HOST);
  });

// allow-git
program
  .command('allow-git')
  .description('Share a git commit with syntax-highlighted diffs')
  .argument('<repo_path>', 'Path to git repository')
  .argument('<commit_hash>', 'Commit hash to share')
  .option('--ttl <seconds>', 'Time-to-live in seconds')
  .option('--port <port>', 'Port for URL generation', String(DEFAULT_PORT))
  .option('--force', 'Continue even when secret scan finds high-confidence secrets', false)
  .option('--no-secret-scan', 'Skip secret scanning before creating authorization')
  .option('--json', 'Output result as JSON', false)
  .option('--qr', 'Print a terminal QR code to stderr', false)
  .action(async (repoPath, commitHash, opts) => {
    ensureStateDir();
    const cfg = loadConfig();
    const port = cfg.port || parseInt(opts.port, 10);
    const ttl = opts.ttl ? parseInt(opts.ttl, 10) : (cfg.file_ttl || DEFAULT_TTL);

    try {
      const secretScan = runSecretScanForCli(opts, () => scanGitCommit(repoPath, commitHash));
      const { token, isNew } = addGitAuthorization(repoPath, commitHash, ttl);
      const url = buildUrl(cfg, 'git', token, port);

      outputShareResult(
        withSecretScanMetadata({
          url, token, type: 'git',
          repo_path: resolve(repoPath), commit_hash: commitHash,
          ttl, expires_at: Date.now() / 1000 + ttl,
        }, secretScan),
        {
          json: opts.json,
          qr: opts.qr,
          stderrMessages: !isNew ? ['(existing authorization extended)'] : [],
        },
      );

      if (!isDaemonRunning()) await startDaemon(port, DEFAULT_HOST);
    } catch (e: any) {
      outputShareError(e.message, { json: opts.json, qr: opts.qr });
      process.exit(1);
    }
  });

// list
program
  .command('list')
  .description('List all shared files, directories, and git commits')
  .option('--json', 'Output list as JSON array', false)
  .action((opts) => {
    const now = Date.now() / 1000;
    const cfg = loadConfig();
    const allShares: any[] = [];

    for (const row of listAuthorizations()) {
      const remaining = row.expires_at - now;
      allShares.push({
        token: row.token, type: 'file', path: row.filepath,
        status: remaining > 0 ? STATUS_ACTIVE : STATUS_EXPIRED,
        remaining: Math.max(0, Math.floor(remaining)),
        expires_at: row.expires_at,
        url: buildUrl(cfg, 'f', row.token, DEFAULT_PORT),
      });
    }

    const db = getDb();
    const gitRows = db.query(
      'SELECT token, repo_path, commit_hash, created_at, expires_at FROM git_authorizations ORDER BY created_at DESC',
    ).all() as any[];
    for (const row of gitRows) {
      const remaining = row.expires_at - now;
      allShares.push({
        token: row.token, type: 'git', path: row.repo_path, name: row.commit_hash.slice(0, 12),
        status: remaining > 0 ? STATUS_ACTIVE : STATUS_EXPIRED,
        remaining: Math.max(0, Math.floor(remaining)),
        expires_at: row.expires_at,
        url: buildUrl(cfg, 'git', row.token, DEFAULT_PORT),
      });
    }

    for (const row of listDirAuthorizations()) {
      const remaining = row.expires_at - now;
      allShares.push({
        token: row.token, type: 'dir', path: row.dirpath,
        status: remaining > 0 ? STATUS_ACTIVE : STATUS_EXPIRED,
        remaining: Math.max(0, Math.floor(remaining)),
        expires_at: row.expires_at,
        url: buildUrl(cfg, 'd', row.token, DEFAULT_PORT),
      });
    }

    if (opts.json) {
      console.log(JSON.stringify(allShares, null, 2));
      return;
    }

    if (!allShares.length) {
      console.log('No active authorizations.');
      return;
    }

    const files = allShares.filter(s => s.type === 'file');
    const dirs = allShares.filter(s => s.type === 'dir');
    const gits = allShares.filter(s => s.type === 'git');

    if (files.length) {
      console.log('Files:');
      for (const s of files) {
        const status = s.status === STATUS_ACTIVE ? `${s.remaining}s remaining` : STATUS_EXPIRED;
        console.log(`  ${s.token}  ${s.path}  [${status}]`);
      }
    }
    if (gits.length) {
      console.log('Git commits:');
      for (const s of gits) {
        const status = s.status === STATUS_ACTIVE ? `${s.remaining}s remaining` : STATUS_EXPIRED;
        console.log(`  ${s.token}  ${displayPath(s.path)} ${s.name}  [${status}]`);
      }
    }
    if (dirs.length) {
      console.log('Directories:');
      for (const s of dirs) {
        const status = s.status === STATUS_ACTIVE ? `${s.remaining}s remaining` : STATUS_EXPIRED;
        console.log(`  ${s.token}  ${displayPath(s.path)}  [${status}]`);
      }
    }
  });

// status
program
  .command('status')
  .description('Check if the daemon is running')
  .option('--json', 'Output status as JSON', false)
  .action((opts) => {
    const pid = readPid();
    const running = isDaemonRunning();
    if (opts.json) {
      console.log(JSON.stringify({ running, pid }));
    } else if (running) {
      console.log(`Daemon is running (pid ${pid}).`);
    } else {
      console.log('Daemon is not running.');
    }
  });

// stop
program
  .command('stop')
  .description('Stop the running daemon')
  .action(() => {
    if (stopDaemon()) {
      console.log('Daemon stopped.');
    } else {
      console.error('Daemon is not running.');
    }
  });

// revoke
program
  .command('revoke')
  .description('Revoke access to a file, directory, or git share by its token')
  .argument('<token>', 'Token to revoke')
  .action((token) => {
    if (removeAuthorization(token)) {
      console.log(`Revoked: ${token}`);
    } else {
      console.error(`Token not found: ${token}`);
    }
  });

// owner-url
program
  .command('owner-url')
  .description('Print the owner dashboard URL')
  .option('--qr', 'Print a terminal QR code to stderr', false)
  .action((opts) => {
    const key = getOwnerKey();
    const cfg = loadConfig();
    const baseUrl = cfg.base_url as string | undefined;
    const url = baseUrl
      ? `${baseUrl.replace(/\/$/, '')}/dashboard?key=${key}`
      : `http://localhost:${DEFAULT_PORT}/dashboard?key=${key}`;
    outputShareResult(
      { url },
      {
        qr: opts.qr,
        stderrMessages: [
          'Open this URL once in your browser — it sets a 30-day cookie.',
          'After that, /dashboard works without the key.',
        ],
      },
    );
  });

// config
const configCmd = program
  .command('config')
  .description('Get or set configuration values');

configCmd
  .command('set')
  .description('Set a config value')
  .argument('<key>', 'Config key')
  .argument('<value>', 'Config value')
  .action((key, value) => {
    try {
      const cfg = loadConfig();
      applyConfigValue(cfg, key, value);
      saveConfig(cfg);
      console.log(`${key} = ${getConfigValue(cfg, key)}`);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });

configCmd
  .command('get')
  .description('Get a config value')
  .argument('<key>', 'Config key')
  .action((key) => {
    if (!isValidConfigKey(key)) {
      console.error(`Unknown config key: ${key}. Valid keys: ${VALID_CONFIG_KEYS.join(', ')}`);
      process.exit(1);
    }
    const cfg = loadConfig();
    const value = getConfigValue(cfg, key);
    if (value === undefined) {
      console.log(`${key}: (not set)`);
    } else {
      console.log(`${key} = ${value}`);
    }
  });

// Default command: if first arg looks like a path (not a known subcommand), treat as `drop allow <path>`
const knownCommands = program.commands.map(c => c.name());
const firstArg = process.argv[2];
if (firstArg && !firstArg.startsWith('-') && !knownCommands.includes(firstArg)) {
  process.argv.splice(2, 0, 'allow');
}

program.parse();
