import { createHash } from 'crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'fs';
import { basename, join } from 'path';
import { DEFAULT_EXCLUDES } from './constants.js';
import { isExcluded } from './fs.js';
import { isSafeSubpath } from './utils.js';

export type SecretSeverity = 'high';

export interface SecretFinding {
  path: string;
  line: number;
  rule_id: string;
  severity: SecretSeverity;
  fingerprint: string;
}

export interface SecretScanResult {
  blocked: boolean;
  findings: SecretFinding[];
}

export interface SecretScanPathOptions {
  excludes?: string[];
}

interface SecretRule {
  id: string;
  pattern: RegExp;
}

const SECRET_RULES: SecretRule[] = [
  { id: 'private-key', pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g },
  { id: 'github-token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36}\b|\bgithub_pat_[A-Za-z0-9_]{22,255}\b/g },
  { id: 'anthropic-api-key', pattern: /\bsk-ant-api\d{2}-[A-Za-z0-9_-]{40,}\b/g },
  { id: 'openai-api-key', pattern: /\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/g },
  { id: 'slack-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{20,}\b/g },
  { id: 'stripe-live-key', pattern: /\bsk_live_[A-Za-z0-9]{16,}\b/g },
  { id: 'google-api-key', pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g },
  { id: 'aws-access-key-id', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
];

const SENSITIVE_FILENAMES = new Set(['credentials.json', 'secrets.yaml', 'secrets.yml', '.npmrc', '.netrc']);
const SENSITIVE_EXTENSIONS = ['.pem', '.key'];
const MAX_SCAN_BYTES = 5 * 1024 * 1024;

function fingerprint(ruleId: string, value: string): string {
  return createHash('sha256').update(`${ruleId}\0${value}`).digest('hex').slice(0, 16);
}

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function pushFinding(findings: SecretFinding[], path: string, line: number, ruleId: string, matchedValue: string): void {
  findings.push({
    path,
    line,
    rule_id: ruleId,
    severity: 'high',
    fingerprint: fingerprint(ruleId, matchedValue),
  });
}

function scanSensitiveFilename(path: string): SecretFinding[] {
  const name = basename(path).toLowerCase();
  if (SENSITIVE_FILENAMES.has(name) || SENSITIVE_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return [{
      path,
      line: 1,
      rule_id: 'sensitive-filename',
      severity: 'high',
      fingerprint: fingerprint('sensitive-filename', name),
    }];
  }
  return [];
}

function scanServiceAccountJson(text: string, path: string): SecretFinding[] {
  if (!/"type"\s*:\s*"service_account"/.test(text)) return [];
  if (!/"private_key"\s*:/.test(text) && !/"private_key_id"\s*:/.test(text)) return [];
  const match = /"type"\s*:\s*"service_account"/.exec(text);
  return [{
    path,
    line: match ? lineNumberAt(text, match.index) : 1,
    rule_id: 'google-service-account-json',
    severity: 'high',
    fingerprint: fingerprint('google-service-account-json', path),
  }];
}

export function scanText(text: string, path = '<stdin>'): SecretScanResult {
  const indexedFindings: Array<{ index: number; finding: SecretFinding }> = [];

  for (const rule of SECRET_RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      if (match.index === undefined || !match[0]) continue;
      const findings: SecretFinding[] = [];
      pushFinding(findings, path, lineNumberAt(text, match.index), rule.id, match[0]);
      indexedFindings.push({ index: match.index, finding: findings[0] });
    }
  }

  for (const finding of scanServiceAccountJson(text, path)) {
    indexedFindings.push({ index: 0, finding });
  }

  const findings = indexedFindings
    .sort((a, b) => a.index - b.index)
    .map((item) => item.finding);

  return { blocked: findings.length > 0, findings };
}

function isProbablyBinary(buffer: Buffer): boolean {
  const len = Math.min(buffer.length, 1024);
  for (let i = 0; i < len; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function scanFile(path: string): SecretFinding[] {
  const findings = scanSensitiveFilename(path);
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return findings;
  }
  if (!stat.isFile() || stat.size > MAX_SCAN_BYTES) return findings;

  let buffer: Buffer;
  try {
    buffer = readFileSync(path);
  } catch {
    return findings;
  }
  if (isProbablyBinary(buffer)) return findings;

  findings.push(...scanText(buffer.toString('utf8'), path).findings);
  return findings;
}

function scanDirectory(root: string, excludes: string[]): SecretFinding[] {
  const rootReal = realpathSync(root);
  const visitedDirs = new Set<string>([rootReal]);
  const findings: SecretFinding[] = [];

  function walk(currentPath: string): void {
    let entries;
    try {
      entries = readdirSync(currentPath, { withFileTypes: true });
    } catch (e: any) {
      if (e?.code === 'EACCES') return;
      throw e;
    }

    for (const entry of entries) {
      const entryPath = join(currentPath, entry.name);
      let isDir = entry.isDirectory();
      const isLink = entry.isSymbolicLink();

      if (isExcluded(entry.name, isDir, excludes)) continue;

      let targetPath = entryPath;
      if (isLink) {
        let realTarget: string;
        try {
          realTarget = realpathSync(entryPath);
        } catch {
          continue;
        }
        if (!isSafeSubpath(rootReal, realTarget)) continue;
        targetPath = realTarget;
        try {
          isDir = statSync(realTarget).isDirectory();
        } catch {
          continue;
        }
        if (isExcluded(entry.name, isDir, excludes)) continue;
      }

      if (isDir) {
        const realDir = realpathSync(targetPath);
        if (visitedDirs.has(realDir)) continue;
        visitedDirs.add(realDir);
        walk(entryPath);
        continue;
      }

      findings.push(...scanFile(entryPath));
    }
  }

  walk(root);
  return findings;
}

export function scanPath(path: string, options: SecretScanPathOptions = {}): SecretScanResult {
  if (!existsSync(path)) return { blocked: false, findings: [] };
  const excludes = [...DEFAULT_EXCLUDES, ...(options.excludes || [])];
  const lst = lstatSync(path);

  if (lst.isSymbolicLink()) {
    let realTarget: string;
    try {
      realTarget = realpathSync(path);
    } catch {
      return { blocked: false, findings: [] };
    }
    const st = statSync(realTarget);
    if (st.isDirectory()) {
      const findings = scanDirectory(realTarget, excludes);
      return { blocked: findings.length > 0, findings };
    }
    const findings = scanFile(path);
    return { blocked: findings.length > 0, findings };
  }

  if (lst.isDirectory()) {
    const findings = scanDirectory(path, excludes);
    return { blocked: findings.length > 0, findings };
  }

  const findings = scanFile(path);
  return { blocked: findings.length > 0, findings };
}

function cleanGitEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('GIT_')) env[key] = value;
  }
  return env;
}

function runGit(args: string[], cwd: string): string {
  const result = Bun.spawnSync(['git', ...args], { cwd, env: cleanGitEnv(), stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

export function scanGitCommit(repoPath: string, commitHash: string): SecretScanResult {
  const findings: SecretFinding[] = [];
  // Scan the same content that gets served to viewers. The served diff
  // (src/db/git-authorizations.ts) uses default context, so unchanged context
  // lines are disclosed too — scan added AND context lines, not just '+' lines,
  // or a secret on a context line adjacent to an edit would leak unscanned.
  const output = runGit(['show', '--format=', '--no-ext-diff', commitHash], repoPath);
  let currentPath = '<git-diff>';
  let newLine = 0;

  for (const line of output.split('\n')) {
    const fileMatch = /^\+\+\+ b\/(.+)$/.exec(line);
    if (fileMatch) {
      currentPath = fileMatch[1];
      continue;
    }

    const hunkMatch = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunkMatch) {
      newLine = Number(hunkMatch[1]);
      continue;
    }

    // Added ('+') and context (' ') lines are both part of the served diff.
    const isAdded = line.startsWith('+') && !line.startsWith('+++');
    const isContext = line.startsWith(' ');
    if (isAdded || isContext) {
      const content = line.slice(1);
      const result = scanText(content, currentPath);
      for (const finding of result.findings) {
        findings.push({ ...finding, line: newLine || finding.line });
      }
      newLine++;
    }
    // Removed ('-') lines are not served; skip them without advancing newLine.
  }

  return { blocked: findings.length > 0, findings };
}
