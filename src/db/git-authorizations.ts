import { randomBytes } from 'crypto';
import { resolve, join } from 'path';
import { existsSync } from 'fs';
import { getDb } from './index.js';
import {
  TOKEN_LENGTH,
  STATUS_VALID, STATUS_EXPIRED, STATUS_NOT_FOUND,
} from '../shared/constants.js';
import type { GitAuthorization, GitCommitInfo, GitFileInfo, AuthorizationStatus } from '../shared/types.js';

export function addGitAuthorization(
  repoPath: string,
  commitHash: string,
  ttl: number,
): { token: string; isNew: boolean } {
  const absRepo = resolve(repoPath);
  if (!existsSync(join(absRepo, '.git'))) {
    throw new Error(`Not a git repository: ${absRepo}`);
  }

  const now = Date.now() / 1000;
  const db = getDb();

  const existing = db.query(
    'SELECT token FROM git_authorizations WHERE repo_path = ? AND commit_hash = ? AND expires_at > ?',
  ).get(absRepo, commitHash, now) as { token: string } | null;

  if (existing) {
    db.query(
      'UPDATE git_authorizations SET expires_at = ? WHERE token = ?',
    ).run(now + ttl, existing.token);
    return { token: existing.token, isNew: false };
  }

  const token = randomBytes(TOKEN_LENGTH).toString('hex');
  db.query(
    'INSERT INTO git_authorizations (token, repo_path, commit_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).run(token, absRepo, commitHash, now, now + ttl);
  return { token, isNew: true };
}

export function lookupGitAuthorization(token: string): { row: GitAuthorization | null; status: AuthorizationStatus } {
  const db = getDb();
  const row = db.query(
    'SELECT token, repo_path, commit_hash, created_at, expires_at FROM git_authorizations WHERE token = ?',
  ).get(token) as GitAuthorization | null;

  if (!row) return { row: null, status: STATUS_NOT_FOUND };
  if (Date.now() / 1000 > row.expires_at) return { row, status: STATUS_EXPIRED };
  return { row, status: STATUS_VALID };
}

function cleanGitEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_') && value !== undefined) env[key] = value;
  }
  return env;
}

function runGit(args: string[], cwd: string): string {
  const result = Bun.spawnSync(['git', ...args], { cwd, env: cleanGitEnv() });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

export function getGitCommitInfo(repoPath: string, commitHash: string): GitCommitInfo {
  const logOutput = runGit(
    ['log', '-1', '--format=%H%n%an%n%ae%n%aI%n%s%n%b', commitHash],
    repoPath,
  );
  const lines = logOutput.trim().split('\n', 6);

  const info: GitCommitInfo = {
    hash: lines[0] || commitHash,
    author_name: lines[1] || '',
    author_email: lines[2] || '',
    date: lines[3] || '',
    subject: lines[4] || '',
    body: (lines[5] || '').trim(),
    files: [],
  };

  const numstatOutput = runGit(
    ['diff-tree', '--no-commit-id', '-r', '--numstat', commitHash],
    repoPath,
  );

  const files: GitFileInfo[] = [];
  for (const line of numstatOutput.trim().split('\n')) {
    if (!line) continue;
    const parts = line.split('\t', 3);
    if (parts.length === 3) {
      files.push({ path: parts[2], added: parts[0], deleted: parts[1], diff: '' });
    }
  }

  for (const f of files) {
    try {
      f.diff = runGit(
        ['diff', `${commitHash}~1`, commitHash, '--', f.path],
        repoPath,
      );
    } catch {
      try {
        f.diff = runGit(
          ['show', commitHash, '--', f.path],
          repoPath,
        );
      } catch {
        f.diff = '';
      }
    }
  }

  info.files = files;
  return info;
}
