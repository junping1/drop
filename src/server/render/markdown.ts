/**
 * Markdown renderer using markdown-it with highlight.js code highlighting.
 */

import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import { readFileSync } from 'fs';
import { getFileMeta } from '../../shared/fs.js';
import { getHighlightCss } from './code.js';
import { markdownPageHtml } from './html-templates.js';

let md: MarkdownIt | null = null;

function getMd(): MarkdownIt {
  if (md) return md;

  md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
    highlight(str: string, lang: string): string {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return '<pre class="hljs"><code class="hljs">' + hljs.highlight(str, { language: lang }).value + '</code></pre>';
        } catch {}
      }
      // Unknown/unmapped language: never run highlightAuto (it scans ~190
      // grammars and can block the single-threaded server on large inputs).
      // Return HTML-escaped plain text instead.
      return '<pre class="hljs"><code class="hljs">' + hljs.highlight(str, { language: 'plaintext' }).value + '</code></pre>';
    },
  });

  // Enable strikethrough
  md.enable('strikethrough');

  // Task list plugin (inline)
  // Replaces [ ] and [x] in list items with checkboxes
  md.core.ruler.after('inline', 'task-lists', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'inline') continue;
      const parent = i > 1 ? tokens[i - 2] : null;
      if (!parent || parent.type !== 'list_item_open') continue;

      const content = tokens[i].content;
      if (content.startsWith('[ ] ')) {
        tokens[i].content = content.slice(4);
        tokens[i].children = md!.parseInline(tokens[i].content, state.env)[0].children;
        // Prepend checkbox
        const checkbox = new state.Token('html_inline', '', 0);
        checkbox.content = '<input type="checkbox" disabled> ';
        tokens[i].children!.unshift(checkbox);
      } else if (content.startsWith('[x] ') || content.startsWith('[X] ')) {
        tokens[i].content = content.slice(4);
        tokens[i].children = md!.parseInline(tokens[i].content, state.env)[0].children;
        const checkbox = new state.Token('html_inline', '', 0);
        checkbox.content = '<input type="checkbox" checked disabled> ';
        tokens[i].children!.unshift(checkbox);
      }
    }
  });

  return md;
}

export function renderMarkdown(filepath: string, head?: number | null, tail?: number | null): string {
  let lines = readFileSync(filepath, 'utf-8').split('\n');

  if (head != null) {
    lines = lines.slice(0, head);
  } else if (tail != null) {
    lines = lines.slice(-tail);
  }

  const source = lines.join('\n');
  const renderer = getMd();
  let bodyHtml = renderer.render(source);

  // Wrap tables for overflow scrolling (matches Python version)
  bodyHtml = bodyHtml
    .replace(/<table>/g, '<div class="table-wrapper"><table>')
    .replace(/<\/table>/g, '</table></div>');

  const meta = getFileMeta(filepath);
  const pygmentsCss = getHighlightCss();

  return markdownPageHtml({
    displayPath: meta.display_path,
    fileMeta: `${meta.size} \u00b7 ${meta.mtime}`,
    bodyHtml,
    pygmentsCss,
  });
}
