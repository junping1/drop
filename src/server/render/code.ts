/**
 * Code file renderer using highlight.js for syntax highlighting.
 */

import hljs from 'highlight.js';
import { readFileSync } from 'fs';
import { extname, basename } from 'path';
import darkCss from 'highlight.js/styles/github-dark.css' with { type: 'text' };
import lightCss from 'highlight.js/styles/github.css' with { type: 'text' };
import { getFileMeta } from '../../shared/fs.js';
import { codePageHtml } from './html-templates.js';

/**
 * Returns CSS for both dark and light themes using prefers-color-scheme.
 * Dark theme is the default; light theme is applied via media query.
 */
export function getHighlightCss(): string {
  return darkCss + '\n@media (prefers-color-scheme: light) {\n' + lightCss + '\n}';
}

/**
 * Map file extension to highlight.js language ID.
 */
function extToLang(filepath: string): string {
  const ext = extname(filepath).toLowerCase();
  const name = basename(filepath).toLowerCase();

  // Extensionless known files
  if (!ext) {
    if (name === 'makefile') return 'makefile';
    if (name === 'dockerfile') return 'dockerfile';
    return '';
  }

  const map: Record<string, string> = {
    '.py': 'python',
    '.js': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.ts': 'typescript',
    '.mts': 'typescript',
    '.cts': 'typescript',
    '.jsx': 'javascript',
    '.tsx': 'typescript',
    '.go': 'go',
    '.rs': 'rust',
    '.rb': 'ruby',
    '.java': 'java',
    '.c': 'c',
    '.cpp': 'cpp',
    '.hpp': 'cpp',
    '.h': 'c',
    '.cs': 'csharp',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.scala': 'scala',
    '.sh': 'bash',
    '.bash': 'bash',
    '.zsh': 'bash',
    '.fish': 'bash',
    '.ps1': 'powershell',
    '.json': 'json',
    '.jsonc': 'json',
    '.json5': 'json',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.toml': 'ini',
    '.ini': 'ini',
    '.cfg': 'ini',
    '.conf': 'ini',
    '.xml': 'xml',
    '.html': 'xml',
    '.htm': 'xml',
    '.css': 'css',
    '.scss': 'scss',
    '.sass': 'scss',
    '.less': 'less',
    '.sql': 'sql',
    '.graphql': 'graphql',
    '.md': 'markdown',
    '.markdown': 'markdown',
    '.diff': 'diff',
    '.patch': 'diff',
    '.lua': 'lua',
    '.php': 'php',
    '.r': 'r',
    '.R': 'r',
    '.pl': 'perl',
    '.pm': 'perl',
    '.dockerfile': 'dockerfile',
    '.makefile': 'makefile',
    '.cmake': 'cmake',
    '.tf': 'terraform',
    '.hcl': 'terraform',
    '.nix': 'nix',
    '.vue': 'xml',
    '.svelte': 'xml',
    '.astro': 'xml',
    '.txt': '',
    '.log': '',
    '.env.example': 'bash',
    '.gitignore': '',
    '.gitattributes': '',
    '.editorconfig': 'ini',
    '.proto': 'protobuf',
    '.bat': 'dos',
    '.cmd': 'dos',
  };

  return map[ext] || '';
}

/**
 * Highlight a code string. Returns the inner HTML (spans only, no pre/code wrapper).
 */
export function highlightCode(code: string, lang: string): string {
  // Remove trailing newline to avoid empty last line
  const trimmed = code.endsWith('\n') ? code.slice(0, -1) : code;

  try {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(trimmed, { language: lang }).value;
    }
  } catch {
    // fall through to auto
  }

  try {
    return hljs.highlightAuto(trimmed).value;
  } catch {
    // Fallback: plain escaped text
    return trimmed.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

export function renderCode(filepath: string, head?: number | null, tail?: number | null): string {
  let lines = readFileSync(filepath, 'utf-8').split('\n');

  if (head != null) {
    lines = lines.slice(0, head);
  } else if (tail != null) {
    lines = lines.slice(-tail);
  }

  const code = lines.join('\n');
  const lang = extToLang(filepath);
  const highlighted = highlightCode(code, lang);

  const meta = getFileMeta(filepath);
  const highlightCss = getHighlightCss();

  return codePageHtml({
    displayPath: meta.display_path,
    fileMeta: `${meta.size} \u00b7 ${meta.mtime} (mtime) \u00b7 ${meta.ctime} (ctime)`,
    highlightedCode: `<pre class="hljs"><code class="hljs">${highlighted}</code></pre>`,
    highlightCss,
  });
}
