import { getGitCommitInfo } from '../../db/git-authorizations.js';
import { htmlEscape } from '../../shared/utils.js';
import { highlightCode } from '../render/code.js';
import { isPathExcluded } from '../../shared/fs.js';

export const DEFAULT_DIR_GIT_COMMIT_LIMIT = 5;
export const OWNER_DIR_GIT_COMMIT_LIMIT = 100;

export interface DirGitCommitSummary {
  sha: string;
  short_sha: string;
  subject: string;
  author_name: string;
  authored_at: string;
}

function cleanGitEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_') && value !== undefined) env[key] = value;
  }
  return env;
}

export function isGitRepo(dirpath: string): boolean {
  const result = Bun.spawnSync(
    ['git', 'rev-parse', '--is-inside-work-tree'],
    { cwd: dirpath, env: cleanGitEnv(), stdout: 'pipe', stderr: 'pipe' },
  );
  return result.exitCode === 0 && result.stdout.toString().trim() === 'true';
}

export function isShaLike(sha: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(sha);
}

export function normalizeDirGitCommitLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_DIR_GIT_COMMIT_LIMIT;
  return Math.max(0, Math.min(Math.floor(limit), OWNER_DIR_GIT_COMMIT_LIMIT));
}

export function listCommits(repoPath: string, limit = DEFAULT_DIR_GIT_COMMIT_LIMIT): DirGitCommitSummary[] {
  if (!isGitRepo(repoPath)) return [];
  const safeLimit = normalizeDirGitCommitLimit(limit);
  if (safeLimit === 0) return [];

  const result = Bun.spawnSync([
    'git',
    'log',
    `-${safeLimit}`,
    '--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e',
  ], { cwd: repoPath, env: cleanGitEnv(), stdout: 'pipe', stderr: 'pipe' });

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().toLowerCase();
    if (stderr.includes('does not have any commits') || stderr.includes('no commits yet')) return [];
    throw new Error(`git log failed: ${result.stderr.toString()}`);
  }

  const output = result.stdout.toString();

  return output
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, short_sha, author_name, authored_at, subject] = record.split('\x1f');
      return {
        sha: sha || '',
        short_sha: short_sha || (sha || '').slice(0, 12),
        subject: subject || '',
        author_name: author_name || '',
        authored_at: authored_at || '',
      };
    })
    .filter((commit) => commit.sha);
}

export function isCommitInRecentWindow(repoPath: string, sha: string, limit = DEFAULT_DIR_GIT_COMMIT_LIMIT): boolean {
  if (!isShaLike(sha)) return false;
  return listCommits(repoPath, limit).some((commit) => commit.sha.startsWith(sha));
}

export function renderCommitDiffHtml(repoPath: string, sha: string, excludes: string[] = []): {
  commit: DirGitCommitSummary;
  diff_html: string;
  file_count: number;
} {
  const info = getGitCommitInfo(repoPath, sha);
  // Never disclose contents of files excluded from the share (e.g. dotfiles
  // hidden by default, or paths the owner excluded). The file-browse routes
  // already enforce this; history diffs must too, or excluded files leak
  // through their current and historical contents.
  const visibleFiles = info.files.filter((file) => !isPathExcluded(file.path, excludes));
  const hiddenCount = info.files.length - visibleFiles.length;
  const filesHtml: string[] = [];

  for (const file of visibleFiles) {
    const stats = `+${file.added} -${file.deleted}`;
    const diffHighlighted = file.diff
      ? '<pre class="hljs"><code class="hljs">' + highlightCode(file.diff, 'diff') + '</code></pre>'
      : '<pre>No diff available</pre>';
    filesHtml.push(
      `<details open><summary><span class="file-path">${htmlEscape(file.path)}</span>` +
      ` <span class="file-stats">(${stats})</span></summary>` +
      `<div class="diff-content">${diffHighlighted}</div></details>`,
    );
  }

  const body = info.body
    ? `<p class="commit-body">${htmlEscape(info.body)}</p>`
    : '';
  const hiddenNote = hiddenCount > 0
    ? `<div class="file-hidden-note">${hiddenCount} excluded file${hiddenCount === 1 ? '' : 's'} hidden</div>`
    : '';
  const diffHtml =
    `<div class="commit-header">` +
    `<div class="commit-subject">${htmlEscape(info.subject)}</div>` +
    body +
    `<div class="commit-meta"><span class="hash">${htmlEscape(info.hash)}</span>` +
    ` · ${htmlEscape(info.author_name)} · ${htmlEscape(info.date)}</div>` +
    `</div>` +
    `<div class="file-summary">${visibleFiles.length} file${visibleFiles.length === 1 ? '' : 's'} changed</div>` +
    hiddenNote +
    `<div class="file-list">${filesHtml.join('\n')}</div>`;

  return {
    commit: {
      sha: info.hash,
      short_sha: info.hash.slice(0, 7),
      subject: info.subject,
      author_name: info.author_name,
      authored_at: info.date,
    },
    diff_html: diffHtml,
    file_count: visibleFiles.length,
  };
}
