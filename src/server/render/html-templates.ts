/**
 * HTML templates for drop renderers.
 * Ported from Python Jinja2 templates — same CSS, same structure.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { htmlEscape, jsSafeJson } from '../../shared/utils.js';

function h(value: unknown): string {
  return htmlEscape(String(value));
}

function attr(value: unknown): string {
  return h(value);
}

export interface BaseHtmlOpts {
  title: string;
  extraCssDark?: string;
  extraCssLight?: string;
  extraCss?: string;
  body: string;
}

export function baseHtml(opts: BaseHtmlOpts): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
<title>${h(opts.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wght@100..900&family=Roboto+Mono:wght@100..700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #1e1e1e;
    --bg-header: #2d2d2d;
    --border: #404040;
    --text: #d4d4d4;
    --text-header: #e0e0e0;
    --text-muted: #888888;
    --link: #6ab0f3;
    --font-sans: 'Google Sans Flex', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    --font-mono: 'Roboto Mono', 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace;
    ${opts.extraCssDark || ''}
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #ffffff;
      --bg-header: #f6f8fa;
      --border: #d0d7de;
      --text: #1f2328;
      --text-header: #1f2328;
      --text-muted: #656d76;
      --link: #0969da;
      ${opts.extraCssLight || ''}
    }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: var(--font-sans);
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
  }
  ${opts.extraCss || ''}
</style>
</head>
<body>
${opts.body}
</body>
</html>`;
}

export interface CodePageOpts {
  displayPath: string;
  fileMeta: string;
  highlightedCode: string;
  highlightCss: string;
}

export function codePageHtml(opts: CodePageOpts): string {
  return baseHtml({
    title: opts.displayPath,
    extraCss: `
  .file-header {
    background: var(--bg-header);
    border-bottom: 1px solid var(--border);
    padding: 12px 16px;
  }
  .file-path {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-header);
    word-break: break-all;
    font-family: var(--font-mono);
  }
  .file-meta {
    font-size: 12px;
    font-weight: 400;
    color: var(--text-muted);
    margin-top: 4px;
    font-family: var(--font-sans);
  }
  .file-content {
    overflow-x: auto;
  }
  ${opts.highlightCss}
  .hljs {
    background: var(--bg) !important;
    padding: 0;
  }
  pre.hljs, pre code.hljs {
    display: block;
    padding: 12px 16px !important;
    margin: 0;
    font-family: var(--font-mono);
    font-size: 14px;
    line-height: 1.4;
    white-space: pre-wrap;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  @media (max-width: 768px) {
    .file-header {
      padding: 10px 12px;
    }
    pre.hljs, pre code.hljs {
      font-size: 13px;
      line-height: 1.4;
      padding: 8px 12px;
    }
  }`,
    body: `
  <div class="file-header">
    <div class="file-path">${h(opts.displayPath)}</div>
    <div class="file-meta">${h(opts.fileMeta)}</div>
  </div>
  <div class="file-content">
    ${opts.highlightedCode}
  </div>`,
  });
}

export interface MarkdownPageOpts {
  displayPath: string;
  fileMeta: string;
  bodyHtml: string;
  pygmentsCss: string;
}

export function markdownPageHtml(opts: MarkdownPageOpts): string {
  return baseHtml({
    title: opts.displayPath,
    extraCssDark: `
    --bg-secondary: #161b22;
    --text-body: #c9d1d9;
    --code-bg: #1f2428;
    --code-color: #f0883e;`,
    extraCssLight: `
    --bg-secondary: #f6f8fa;
    --text-body: #1f2328;
    --code-bg: #eff1f3;
    --code-color: #cf222e;`,
    extraCss: `
  :root {
    --bg: #0d1117;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #ffffff;
    }
  }
  html { overflow-x: hidden; }
  body {
    font-weight: 400;
    font-synthesis: none;
    overflow-x: hidden;
  }
  .markdown-body {
    max-width: 860px;
    margin: 0 auto;
    padding: 40px 24px 32px;
    line-height: 1.7;
  }
  .markdown-body h1, .markdown-body h2, .markdown-body h3,
  .markdown-body h4, .markdown-body h5, .markdown-body h6 {
    color: var(--text);
    font-weight: 600;
    line-height: 1.4;
    margin-top: 24px;
    margin-bottom: 12px;
  }
  .markdown-body h1 { font-size: 2em; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
  .markdown-body h2 { font-size: 1.5em; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
  .markdown-body h3 { font-size: 1.25em; }
  .markdown-body p { margin-bottom: 16px; color: var(--text-body); }
  .markdown-body a { color: var(--link); text-decoration: none; }
  .markdown-body a:hover { text-decoration: underline; }
  .markdown-body strong { color: var(--text); font-weight: 600; }
  .markdown-body em { color: var(--text-body); }
  .markdown-body ul, .markdown-body ol {
    padding-left: 2em;
    margin-bottom: 16px;
    color: var(--text-body);
  }
  .markdown-body li { margin-bottom: 4px; }
  .markdown-body li input[type="checkbox"] { margin-right: 6px; }
  .markdown-body blockquote {
    border-left: 4px solid var(--border);
    padding: 4px 16px;
    color: var(--text-muted);
    margin-bottom: 16px;
  }
  .markdown-body hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 24px 0;
  }
  .table-wrapper {
    width: 100%;
    overflow-x: auto;
    margin-bottom: 16px;
  }
  .markdown-body table {
    border-collapse: collapse;
    min-width: 100%;
    font-size: 14px;
    margin-bottom: 0;
  }
  .markdown-body th {
    background: var(--bg-secondary);
    color: var(--text);
    padding: 8px 16px;
    border: 1px solid var(--border);
    text-align: left;
    font-weight: 600;
    white-space: nowrap;
  }
  .markdown-body td {
    padding: 8px 16px;
    border: 1px solid var(--border);
    color: var(--text-body);
  }
  .markdown-body tr:nth-child(even) td { background: var(--bg-secondary); }
  .markdown-body code {
    font-family: var(--font-mono);
    font-size: 85%;
    background: var(--code-bg);
    color: var(--code-color);
    padding: 2px 6px;
    border-radius: 4px;
  }
  .markdown-body pre {
    margin: 24px 0;
    border-radius: 6px;
    overflow: hidden;
  }
  .markdown-body pre code {
    background: none;
    color: inherit;
    padding: 0;
    font-size: 14px;
  }
  ${opts.pygmentsCss}
  pre.hljs, .markdown-body pre code.hljs {
    display: block;
    padding: 14px 16px !important;
    margin: 0;
    font-family: var(--font-mono);
    font-size: 14px;
    line-height: 1.4;
    white-space: pre;
    overflow-x: auto;
    background: var(--bg-secondary) !important;
    border-radius: 6px;
  }
  .file-footer {
    max-width: 860px;
    margin: 0 auto;
    padding: 16px 24px 32px;
    border-top: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .file-footer-path {
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text-muted);
  }
  .file-footer-meta {
    font-size: 12px;
    color: var(--text-muted);
    opacity: 0.6;
  }
  @media (max-width: 768px) {
    .markdown-body { padding: 24px 16px 24px; }
    .markdown-body h1 { font-size: 1.6em; }
    .markdown-body h2 { font-size: 1.3em; }
    .file-footer { padding: 12px 16px 24px; }
  }`,
    body: `
  <div class="markdown-body">
    ${opts.bodyHtml}
  </div>
  <footer class="file-footer">
    <span class="file-footer-path">${h(opts.displayPath)}</span>
    <span class="file-footer-meta">${h(opts.fileMeta)}</span>
  </footer>`,
  });
}

export interface CsvPageOpts {
  displayPath: string;
  fileMeta: string;
  bodyHtml: string;
}

export function csvPageHtml(opts: CsvPageOpts): string {
  return baseHtml({
    title: opts.displayPath,
    extraCssDark: `--bg-row-even: #252525;`,
    extraCssLight: `--bg-row-even: #f6f8fa;`,
    extraCss: `
  .file-header {
    background: var(--bg-header);
    border-bottom: 1px solid var(--border);
    padding: 12px 16px;
  }
  .file-path {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-header);
    font-family: var(--font-mono);
  }
  .file-meta {
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 4px;
  }
  .table-container {
    overflow-x: auto;
    padding: 0;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 13px;
    font-family: var(--font-mono);
  }
  thead th {
    background: var(--bg-header);
    color: var(--text-header);
    padding: 8px 12px;
    text-align: left;
    font-weight: 600;
    border-bottom: 2px solid var(--border);
    white-space: nowrap;
    position: sticky;
    top: 0;
    z-index: 1;
  }
  tbody td {
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
    max-width: 400px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  tbody tr:nth-child(even) td {
    background: var(--bg-row-even);
  }
  tbody tr:hover td {
    background: var(--bg-header);
  }
  @media (max-width: 768px) {
    .file-header { padding: 10px 12px; }
    table { font-size: 12px; }
    thead th, tbody td { padding: 5px 8px; }
  }`,
    body: `
  <div class="file-header">
    <div class="file-path">${h(opts.displayPath)}</div>
    <div class="file-meta">${h(opts.fileMeta)}</div>
  </div>
  <div class="table-container">
    ${opts.bodyHtml}
  </div>`,
  });
}

export interface MediaPageOpts {
  displayPath: string;
  fileMeta: string;
  mediaHtml: string;
}

export function mediaPageHtml(opts: MediaPageOpts): string {
  return baseHtml({
    title: opts.displayPath,
    extraCss: `
  body {
    display: flex;
    flex-direction: column;
  }
  .file-header {
    background: var(--bg-header);
    border-bottom: 1px solid var(--border);
    padding: 12px 16px;
  }
  .file-path {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-header);
    font-family: var(--font-mono);
  }
  .file-meta {
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 4px;
  }
  .media-container {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  video, audio {
    max-width: 100%;
    max-height: 80vh;
    border-radius: 8px;
  }
  audio {
    width: 100%;
    max-width: 500px;
  }
  .svg-container {
    max-width: 100%;
    max-height: 80vh;
    overflow: auto;
  }
  .svg-container svg {
    max-width: 100%;
    height: auto;
  }`,
    body: `
  <div class="file-header">
    <div class="file-path">${h(opts.displayPath)}</div>
    <div class="file-meta">${h(opts.fileMeta)}</div>
  </div>
  <div class="media-container">
    ${opts.mediaHtml}
  </div>`,
  });
}

export interface GitPageOpts {
  repoPath: string;
  shortHash: string;
  fullHash: string;
  authorName: string;
  authorEmail: string;
  date: string;
  subject: string;
  bodyHtml: string;
  filesHtml: string;
  fileCount: number;
  pygmentsCss: string;
}

export function gitPageHtml(opts: GitPageOpts): string {
  return baseHtml({
    title: `${opts.repoPath} \u00b7 ${opts.shortHash}`,
    extraCssDark: `
    --bg-file: #252525;
    --bg-file-hover: #2d2d2d;
    --text-body: #b0b0b0;`,
    extraCssLight: `
    --bg-file: #f6f8fa;
    --bg-file-hover: #eef1f4;
    --text-body: #57606a;`,
    extraCss: `
  .commit-header {
    background: var(--bg-header);
    border-bottom: 1px solid var(--border);
    padding: 16px 20px;
  }
  .commit-repo {
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text-muted);
    margin-bottom: 10px;
  }
  .commit-subject {
    font-size: 17px;
    font-weight: 600;
    color: var(--text-header);
    margin-bottom: 8px;
    line-height: 1.4;
  }
  .commit-body {
    font-size: 14px;
    color: var(--text-body);
    white-space: pre-wrap;
    margin-bottom: 10px;
    line-height: 1.6;
  }
  .commit-meta {
    font-size: 13px;
    color: var(--text-muted);
  }
  .commit-meta .hash {
    font-family: var(--font-mono);
    color: var(--link);
  }
  .file-summary {
    padding: 10px 20px;
    font-size: 13px;
    color: var(--text-muted);
    background: var(--bg-header);
    border-bottom: 1px solid var(--border);
  }
  .file-list {
    padding: 4px 0;
  }
  .file-list details {
    border-bottom: 1px solid var(--border);
  }
  .file-list summary {
    padding: 10px 20px;
    cursor: pointer;
    font-size: 13px;
    font-family: var(--font-mono);
    background: var(--bg-file);
    display: flex;
    align-items: center;
    gap: 12px;
    list-style: none;
  }
  .file-list summary::-webkit-details-marker { display: none; }
  .file-list summary::before {
    content: '\\25b6';
    font-size: 10px;
    color: var(--text-muted);
    transition: transform 0.15s;
    flex-shrink: 0;
  }
  .file-list details[open] summary::before { transform: rotate(90deg); }
  .file-list summary:hover {
    background: var(--bg-file-hover);
  }
  .file-path {
    color: var(--text-header);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file-stats {
    color: var(--text-muted);
    font-size: 12px;
    flex-shrink: 0;
  }
  .diff-content {
    overflow-x: auto;
  }
  ${opts.pygmentsCss}
  .hljs {
    background: var(--bg) !important;
    padding: 0;
  }
  pre.hljs, pre code.hljs {
    display: block;
    padding: 10px 20px !important;
    margin: 0;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.4;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
  @media (max-width: 768px) {
    .commit-header { padding: 12px 16px; }
    .file-list summary { padding: 8px 12px; }
    pre.hljs, pre code.hljs { font-size: 12px; padding: 8px 12px; }
  }`,
    body: `
  <div class="commit-header">
    <div class="commit-repo">${h(opts.repoPath)}</div>
    <div class="commit-subject">${h(opts.subject)}</div>
    ${opts.bodyHtml}
    <div class="commit-meta">
      <span class="hash">${h(opts.shortHash)}</span> &middot; ${h(opts.authorName)} &lt;${h(opts.authorEmail)}&gt; &middot; ${h(opts.date)}
    </div>
  </div>
  <div class="file-summary">${h(opts.fileCount)} files changed</div>
  <div class="file-list">
    ${opts.filesHtml}
  </div>`,
  });
}

export interface ExpiredPageOpts {
  filename: string;
  verifyUrl: string;
}

export function expiredPageHtml(opts: ExpiredPageOpts): string {
  const unlockHtml = opts.verifyUrl
    ? `<a class="unlock" href="${attr(opts.verifyUrl)}">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" style="vertical-align: -2px; margin-right: 6px;"><path d="M8 1a4 4 0 00-4 4v2H3a1 1 0 00-1 1v6a1 1 0 001 1h10a1 1 0 001-1V8a1 1 0 00-1-1h-1V5a4 4 0 00-4-4zm2.5 6H5.5V5a2.5 2.5 0 015 0v2z"/></svg>
        Unlock with password
      </a>`
    : '';
  return baseHtml({
    title: 'File Expired',
    extraCssDark: `--bg-pattern: rgba(255,255,255,0.02);`,
    extraCssLight: `--bg-pattern: rgba(0,0,0,0.02);`,
    extraCss: `
  body {
    display: flex;
    align-items: center;
    justify-content: center;
    background-image: radial-gradient(circle at 25% 25%, var(--bg-pattern) 1px, transparent 1px);
    background-size: 24px 24px;
  }
  .container {
    max-width: 420px;
    width: 100%;
    padding: 40px 24px;
    text-align: center;
  }
  .lock-icon {
    font-size: 48px;
    margin-bottom: 16px;
    opacity: 0.5;
  }
  h1 {
    font-size: 1.4em;
    color: var(--text-header);
    margin-bottom: 12px;
    font-weight: 600;
  }
  p {
    color: var(--text-muted);
    font-size: 14px;
    line-height: 1.6;
  }
  p strong {
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 13px;
  }
  .unlock {
    display: inline-flex;
    align-items: center;
    margin-top: 28px;
    background: #4a9eff;
    color: #fff;
    text-decoration: none;
    padding: 12px 28px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    transition: background 0.15s, box-shadow 0.15s;
    box-shadow: 0 2px 8px rgba(74,158,255,0.3);
  }
  .unlock:hover {
    background: #3a8eef;
    box-shadow: 0 4px 12px rgba(74,158,255,0.4);
  }`,
    body: `
<div class="container">
  <div class="lock-icon">
    <svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="8" y="22" width="32" height="20" rx="3" fill="currentColor" opacity="0.15" stroke="currentColor"/>
      <path d="M14 22V16a10 10 0 0120 0v6"/>
      <circle cx="24" cy="33" r="3" fill="currentColor"/>
    </svg>
  </div>
  <h1>This file is no longer available</h1>
  <p><strong>${h(opts.filename)}</strong> has expired and can no longer be accessed.</p>
  ${unlockHtml}
</div>`,
  });
}

export interface VerifyPageOpts {
  nextUrl: string;
  error: string;
}

export function verifyPageHtml(opts: VerifyPageOpts): string {
  const errorHtml = opts.error ? `<p class="error">${h(opts.error)}</p>` : '';
  return baseHtml({
    title: 'Verification Required',
    extraCss: `
  body { display: flex; align-items: center; justify-content: center; }
  .container { max-width: 400px; width: 100%; padding: 32px 16px; text-align: center; }
  h1 { font-size: 1.3em; color: var(--text-header); margin-bottom: 8px; }
  p { color: var(--text-muted); font-size: 14px; }
  .hint { color: var(--text-muted); font-size: 13px; margin-bottom: 16px; }
  form { display: flex; flex-direction: column; gap: 12px; }
  input[type="password"] { background: var(--bg-header); border: 1px solid var(--border); color: var(--text-header);
    padding: 10px 14px; border-radius: 6px; font-size: 16px; outline: none; width: 100%;
    -webkit-appearance: none; }
  input[type="password"]:focus { border-color: var(--link); }
  button { background: #4a9eff; color: #fff; border: none; padding: 10px 14px;
    border-radius: 6px; font-size: 14px; cursor: pointer; font-weight: 500; }
  button:hover { background: #3a8eef; }
  .error { color: #f44; font-size: 13px; }`,
    body: `
<div class="container">
  <h1>This content has expired</h1>
  <p class="hint">Enter password to unlock access</p>
  <form method="POST" action="/verify">
    <input type="hidden" name="next" value="${attr(opts.nextUrl)}">
    <input type="password" name="password" placeholder="Password" autofocus>
    <button type="submit">Unlock</button>
    ${errorHtml}
  </form>
</div>`,
  });
}

export interface DashboardPageOpts {
  shares: Array<{
    type: string;
    display_path: string;
    path: string;
    token: string;
    slug?: string;
    public_id?: string;
    url: string;
    created_str: string;
    expires_str: string;
    views: number;
    unique: number;
    last_access_str: string;
    status: string;
  }>;
  shareCount: number;
  activeCount: number;
}

export function dashboardPageHtml(opts: DashboardPageOpts): string {
  let tableBody = '';
  if (opts.shares.length === 0) {
    tableBody = '<div class="empty-state">No shares yet</div>';
  } else {
    let rows = '';
    for (const s of opts.shares) {
      const rowClass = s.status === 'expired' ? 'expired-row' : '';
      rows += `
      <tr class="${rowClass}">
        <td><span class="type-badge type-${attr(s.type)}">${h(s.type)}</span></td>
        <td class="path" title="${attr(s.path)}">${h(s.display_path)}</td>
        <td><a class="token-link" href="${attr(s.url)}">${h(s.slug || (s.token.slice(0, 8) + '…'))}</a></td>
        <td>${h(s.created_str)}</td>
        <td>${h(s.expires_str)}</td>
        <td>${h(s.views ?? 0)}</td>
        <td>${h(s.unique ?? 0)}</td>
        <td>${h(s.last_access_str ?? '—')}</td>
        <td class="status-${attr(s.status)}">${h(s.status)}</td>
      </tr>`;
    }
    tableBody = `
  <table class="shares-table">
    <thead>
      <tr><th>Type</th><th>Path</th><th>Public ID</th><th>Created</th><th>Expires</th><th>Views</th><th>Unique</th><th>Last access</th><th>Status</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
  }

  return baseHtml({
    title: 'Dashboard \u2014 drop',
    extraCssDark: `
    --bg-row: #252526;
    --bg-row-hover: #2a2d2e;
    --green: #4ec994;
    --red: #f4796b;`,
    extraCssLight: `
    --bg-row: #ffffff;
    --bg-row-hover: #f6f8fa;
    --green: #1a7f37;
    --red: #cf222e;`,
    extraCss: `
  .page-header {
    background: var(--bg-header);
    border-bottom: 1px solid var(--border);
    padding: 16px 24px;
  }
  .page-header h1 {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-header);
  }
  .page-header .subtitle {
    font-size: 13px;
    color: var(--text-muted);
    margin-top: 4px;
  }
  .shares-table {
    width: 100%;
    border-collapse: collapse;
  }
  .shares-table th {
    background: var(--bg-header);
    text-align: left;
    padding: 8px 16px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid var(--border);
  }
  .shares-table td {
    padding: 10px 16px;
    font-size: 13px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-row);
  }
  .shares-table tr:hover td { background: var(--bg-row-hover); }
  .shares-table .type-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
  }
  .type-file { background: #2d4a7a; color: #8bb9fe; }
  .type-dir { background: #2d5a3a; color: #7cda9c; }
  .type-git { background: #5a3a2d; color: #daa07c; }
  @media (prefers-color-scheme: light) {
    .type-file { background: #dbeafe; color: #1e40af; }
    .type-dir { background: #dcfce7; color: #166534; }
    .type-git { background: #fef3c7; color: #92400e; }
  }
  .shares-table .path {
    font-family: var(--font-mono);
    font-size: 12px;
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .shares-table .token-link {
    font-family: var(--font-mono);
    color: var(--link);
    text-decoration: none;
  }
  .shares-table .token-link:hover { text-decoration: underline; }
  .status-active { color: var(--green); }
  .status-expired { color: var(--red); opacity: 0.7; }
  .expired-row td { opacity: 0.5; }
  .empty-state {
    text-align: center;
    padding: 60px 24px;
    color: var(--text-muted);
  }
  @media (max-width: 768px) {
    .shares-table { font-size: 12px; }
    .shares-table th, .shares-table td { padding: 8px 10px; }
  }`,
    body: `
  <div class="page-header">
    <h1>drop dashboard</h1>
    <div class="subtitle">${opts.shareCount} shares (${opts.activeCount} active)</div>
  </div>
  ${tableBody}`,
  });
}

export interface DirBrowserShellOpts {
  dirname: string;
  token: string;
  expiresAt: string;
  initialFile: string;
  basePath: string;
  treeJson: string;
}

// Cache the built Svelte assets at module load time
let _svelteJs = '';
let _svelteCss = '';

function loadSvelteAssets() {
  if (_svelteJs) return;

  // Try embedded assets first (compiled binary)
  try {
    const embedded = require('../../../dist/generated/embedded-assets.ts');
    if (embedded.SVELTE_JS) {
      _svelteJs = embedded.SVELTE_JS;
      _svelteCss = embedded.SVELTE_CSS || '';
      return;
    }
  } catch { /* not compiled — fall through to disk */ }

  // Dev mode: read from dist/web/ on disk
  let distDir: string;
  if (typeof import.meta.dir === 'string') {
    distDir = join(import.meta.dir, '..', '..', '..', 'dist', 'web');
  } else {
    distDir = join(process.cwd(), 'dist', 'web');
  }

  try {
    _svelteJs = readFileSync(join(distDir, 'app.js'), 'utf-8');
    try {
      _svelteCss = readFileSync(join(distDir, 'app.css'), 'utf-8');
    } catch {
      _svelteCss = '';
    }
  } catch {
    _svelteJs = 'console.error("Svelte assets not built. Run: bun run build:web")';
    _svelteCss = '';
  }
}

export function dirBrowserShellHtml(opts: DirBrowserShellOpts): string {
  loadSvelteAssets();

  return baseHtml({
    title: `${opts.dirname} \u2014 drop`,
    extraCssDark: `
    --bg-sidebar: #252526;
    --bg-hover: #2a2d2e;
    --bg-active: #37373d;
    --text-dim: #6a6a6a;
    --accent: #4a9eff;
    --shadow-sidebar: rgba(0,0,0,0.3);
    --shadow-header: rgba(0,0,0,0.2);
    --skeleton-base: #333;
    --skeleton-shine: #444;`,
    extraCssLight: `
    --bg-sidebar: #f3f3f3;
    --bg-hover: #e8e8e8;
    --bg-active: #d6d6d6;
    --text-dim: #999;
    --accent: #0969da;
    --shadow-sidebar: rgba(0,0,0,0.1);
    --shadow-header: rgba(0,0,0,0.08);
    --skeleton-base: #e0e0e0;
    --skeleton-shine: #f0f0f0;`,
    extraCss: `
  html, body { height: 100%; overflow: hidden; }
  body {
    display: flex;
    flex-direction: column;
  }
  #app {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }

  /* Header */
  .header {
    background: var(--bg-header);
    border-bottom: 1px solid var(--border);
    padding: 10px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
    min-height: 44px;
    box-shadow: 0 1px 3px var(--shadow-header);
    z-index: 10;
  }
  .menu-btn {
    display: none;
    background: none;
    border: none;
    color: var(--text-header);
    font-size: 20px;
    cursor: pointer;
    padding: 4px 6px;
    -webkit-tap-highlight-color: transparent;
  }
  .dirname {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-header);
    font-family: var(--font-mono);
  }
  .shared-badge {
    margin-left: auto;
    font-size: 11px;
    color: var(--text-dim);
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .shared-badge svg {
    opacity: 0.6;
  }

  /* Layout */
  .layout {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  /* Sidebar */
  .sidebar {
    width: 280px;
    min-width: 280px;
    background: var(--bg-sidebar);
    border-right: none;
    box-shadow: 1px 0 3px var(--shadow-sidebar);
    overflow-y: auto;
    overflow-x: hidden;
    flex-shrink: 0;
  }
  .sidebar::-webkit-scrollbar { width: 6px; }
  .sidebar::-webkit-scrollbar-track { background: transparent; }
  .sidebar::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

  /* Search */
  .search-box {
    padding: 10px 12px 6px;
    position: sticky;
    top: 0;
    background: var(--bg-sidebar);
    z-index: 1;
    display: flex;
    align-items: center;
    position: relative;
  }
  .search-icon {
    position: absolute;
    left: 22px;
    color: var(--text-dim);
    pointer-events: none;
  }
  .search-box input {
    width: 100%;
    padding: 7px 10px 7px 32px;
    font-size: 12px;
    font-family: var(--font-sans);
    background: var(--bg);
    color: var(--text);
    border: 1px solid transparent;
    border-radius: 8px;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .search-box input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 25%, transparent);
  }
  .search-box input::placeholder { color: var(--text-dim); }

  /* File tree items */
  .tree-item {
    display: flex;
    align-items: center;
    padding: 5px 12px;
    cursor: pointer;
    font-size: 13px;
    color: var(--text);
    white-space: nowrap;
    user-select: none;
    border-radius: 4px;
    margin: 1px 6px;
    text-decoration: none;
    transition: background 0.1s;
  }
  .tree-item:hover { background: var(--bg-hover); }
  .tree-item.active {
    background: var(--bg-active);
    border-left: 3px solid var(--accent);
    padding-left: 9px;
    border-radius: 2px;
  }
  .tree-item:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .tree-item .icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    text-align: center;
    font-size: 11px;
    color: var(--text-muted);
    margin-right: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .tree-item .icon-svg {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .tree-item .icon-svg svg {
    display: block;
  }
  .tree-item .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tree-group.open { display: block; }

  /* Preview pane */
  .preview-pane {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .preview-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: 14px;
    gap: 8px;
  }
  .empty-main {
    font-size: 14px;
    font-weight: 400;
    color: var(--text-dim);
  }

  /* Skeleton loading */
  .preview-loading {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .skeleton-container {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 300px;
    max-width: 80%;
  }
  .skeleton-bar {
    height: 14px;
    border-radius: 6px;
    background: linear-gradient(90deg, var(--skeleton-base) 25%, var(--skeleton-shine) 50%, var(--skeleton-base) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
  }
  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* Preview header bar */
  .preview-header-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    background: var(--bg-header);
    border-bottom: 1px solid var(--border);
    padding-right: 12px;
  }
  .preview-header-bar .breadcrumb {
    flex: 1;
    border-bottom: none;
    min-width: 0;
  }
  .file-info {
    font-size: 11px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    white-space: nowrap;
    flex-shrink: 0;
  }

  /* Preview content */
  .preview-content-fade {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .preview-frame {
    flex: 1;
    border: none;
    width: 100%;
    height: 100%;
    background: var(--bg);
  }
  .preview-image {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    overflow: auto;
    background: var(--bg);
  }
  .preview-image img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 6px;
  }
  .preview-binary {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--text-muted);
  }
  .preview-binary .filename {
    font-family: var(--font-mono);
    font-size: 14px;
    color: var(--text);
  }
  .preview-binary .dl-btn {
    display: inline-block;
    background: var(--accent);
    color: #fff;
    text-decoration: none;
    padding: 10px 24px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    transition: box-shadow 0.15s, opacity 0.15s;
  }
  .preview-binary .dl-btn:hover {
    opacity: 0.9;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  }

  /* Mobile back bar (preview view) */
  .mobile-back-bar {
    display: none;
  }
  .mobile-back-btn {
    background: none;
    border: none;
    color: var(--text-header);
    cursor: pointer;
    padding: 4px 8px;
    display: flex;
    align-items: center;
    -webkit-tap-highlight-color: transparent;
  }
  .mobile-back-filename {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-header);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  /* Sidebar overlay (mobile hamburger) */
  .sidebar-overlay {
    display: none;
    position: fixed;
    inset: 0;
    top: 44px;
    background: rgba(0,0,0,0);
    z-index: 99;
    -webkit-tap-highlight-color: transparent;
    transition: background 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .sidebar-overlay.visible {
    display: block;
    background: rgba(0,0,0,0.4);
  }

  /* Breadcrumb */
  .breadcrumb {
    padding: 6px 16px;
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--text-muted);
    background: var(--bg-header);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: flex;
    align-items: center;
    gap: 0;
  }
  .breadcrumb-sep {
    color: var(--text-dim);
    flex-shrink: 0;
  }
  .breadcrumb-segment {
    flex-shrink: 0;
  }
  .breadcrumb-link {
    background: none;
    border: none;
    font: inherit;
    color: var(--link);
    cursor: pointer;
    padding: 0;
    text-decoration: none;
  }
  .breadcrumb-link:hover {
    text-decoration: underline;
  }
  .breadcrumb-current {
    color: var(--text);
    font-weight: 500;
  }

  /* === Mobile === */
  @media (max-width: 768px) {
    .menu-btn { display: none; }

    /* Two-state mobile nav: list vs preview */
    .layout {
      position: relative;
    }

    .sidebar {
      position: absolute;
      inset: 0;
      width: 100% !important;
      min-width: 100% !important;
      z-index: 10;
      box-shadow: none;
      transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      transform: translateX(0);
    }
    .layout.mobile-preview .sidebar {
      transform: translateX(-100%);
    }

    .preview-pane {
      position: absolute;
      inset: 0;
      z-index: 5;
      transform: translateX(100%);
      transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      background: var(--bg);
    }
    .layout.mobile-preview .preview-pane {
      transform: translateX(0);
    }

    .mobile-back-bar {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 8px 8px;
      background: var(--bg-header);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }

    /* Hide desktop breadcrumb on mobile (back bar replaces it) */
    .preview-header-bar .breadcrumb {
      display: none;
    }
    .preview-header-bar {
      padding: 4px 12px;
      justify-content: flex-end;
    }

    /* Larger touch targets */
    .tree-item {
      padding: 8px 12px;
      font-size: 14px;
      margin: 1px 4px;
    }
    .tree-item .icon {
      width: 20px;
      height: 20px;
      margin-right: 8px;
    }
    .search-box {
      padding: 10px 12px 6px;
    }
    .search-box input {
      padding: 9px 12px 9px 34px;
      font-size: 14px;
    }
    .preview-image {
      padding: 12px;
    }
    .preview-image img {
      border-radius: 4px;
    }
    .header {
      padding: 8px 12px;
    }
    .dirname {
      font-size: 13px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
  }
  ${_svelteCss}`,
    body: `
  <div id="app"></div>
  <script>window.__DROP__ = {
    token: ${jsSafeJson(opts.token)},
    dirname: ${jsSafeJson(opts.dirname)},
    tree: ${opts.treeJson},
    expiresAt: ${opts.expiresAt},
    initialFile: ${jsSafeJson(opts.initialFile)},
    basePath: ${jsSafeJson(opts.basePath)}
  };</script>
  <script>${_svelteJs}</script>`,
  });
}
