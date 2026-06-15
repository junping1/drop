/**
 * Git commit serving route: GET /git/:token
 */

import { Hono } from 'hono';
import { lookupGitAuthorization, getGitCommitInfo } from '../../db/git-authorizations.js';
import { resolveShareToken } from '../../db/share-aliases.js';
import { STATUS_NOT_FOUND, STATUS_EXPIRED } from '../../shared/constants.js';
import { displayPath, htmlEscape } from '../../shared/utils.js';
import { handleExpired } from '../middleware/auth.js';
import { gitPageHtml } from '../render/html-templates.js';
import { highlightCode, getHighlightCss } from '../render/code.js';
import { recordRouteAccess } from '../access-logging.js';

const gitRoutes = new Hono();

gitRoutes.get('/git/:token', (c) => {
  const publicId = c.req.param('token');
  const token = resolveShareToken('git', publicId);
  const { row, status } = lookupGitAuthorization(token);

  if (status === STATUS_NOT_FOUND) {
    return c.text('Not found', 404);
  }

  if (status === STATUS_EXPIRED) {
    const expiredHtml = handleExpired(c, row!, 'commit_hash', token, 'git_authorizations');
    if (expiredHtml !== null) {
      return c.html(expiredHtml);
    }
  }

  const repoPath = row!.repo_path;
  const commitHash = row!.commit_hash;

  let info;
  try {
    info = getGitCommitInfo(repoPath, commitHash);
  } catch (e: any) {
    return c.text(`Failed to read git commit: ${e.message}`, 500);
  }

  const pygmentsCss = getHighlightCss();

  const filesHtml: string[] = [];
  for (const f of info.files) {
    const stats = `+${f.added} -${f.deleted}`;
    let diffHighlighted: string;
    if (f.diff) {
      diffHighlighted = '<pre class="hljs"><code class="hljs">' + highlightCode(f.diff, 'diff') + '</code></pre>';
    } else {
      diffHighlighted = '<pre>No diff available</pre>';
    }
    filesHtml.push(
      `<details><summary><span class="file-path">${htmlEscape(f.path)}</span>` +
      ` <span class="file-stats">(${stats})</span></summary>` +
      `<div class="diff-content">${diffHighlighted}</div></details>`
    );
  }

  const repoDisplay = displayPath(repoPath);
  const shortHash = info.hash.slice(0, 12);
  const bodyHtml = info.body
    ? `<p class="commit-body">${htmlEscape(info.body)}</p>`
    : '';

  recordRouteAccess(c, token, 'git', 'page_view');
  return c.html(gitPageHtml({
    repoPath: repoDisplay,
    shortHash,
    fullHash: info.hash,
    authorName: info.author_name,
    authorEmail: info.author_email,
    date: info.date,
    subject: info.subject,
    bodyHtml,
    filesHtml: filesHtml.join('\n'),
    fileCount: info.files.length,
    pygmentsCss,
  }));
});

export { gitRoutes };
