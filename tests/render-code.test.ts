import { describe, expect, test } from 'bun:test';
import { highlightCode } from '../src/server/render/code.js';
import { renderMarkdown } from '../src/server/render/markdown.js';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('highlightCode never runs highlightAuto', () => {
  test('a 200KB unmapped-language input highlights in under 500ms and equals escaped input', () => {
    // ~200KB of repetitive log-like text, unknown language.
    const line = 'INFO 2026-09-08 12:00:00 something happened in the system\n';
    const repeatCount = Math.ceil((200 * 1024) / line.length);
    const input = line.repeat(repeatCount);

    const start = performance.now();
    const result = highlightCode(input, '');
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);

    const trimmed = input.endsWith('\n') ? input.slice(0, -1) : input;
    const escaped = trimmed
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    expect(result).toBe(escaped);
  });

  test('content with <script> in an unmapped-extension file is escaped', () => {
    const input = '<script>alert(1)</script>';
    const result = highlightCode(input, '');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });
});

describe('markdown fenced code blocks never run highlightAuto', () => {
  test('fenced block without language is escaped and wrapped; js block is still highlighted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drop-md-test-'));
    const filepath = join(dir, 'test.md');
    const content = [
      '```',
      '<script>alert(1)</script>',
      '```',
      '',
      '```js',
      'const x = 1;',
      '```',
      '',
    ].join('\n');
    writeFileSync(filepath, content, 'utf-8');

    try {
      const html = renderMarkdown(filepath);

      // Unlabeled block: escaped and wrapped in hljs pre/code, no raw script tag.
      expect(html).toContain('<pre class="hljs"><code class="hljs">&lt;script&gt;alert(1)&lt;/script&gt;\n</code></pre>');

      // JS block: still highlighted with an hljs- span.
      expect(html).toMatch(/<pre class="hljs"><code class="hljs">[\s\S]*hljs-[\s\S]*<\/code><\/pre>/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
