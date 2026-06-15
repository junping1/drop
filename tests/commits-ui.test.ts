import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, test } from 'bun:test';

describe('commits tab UI regressions', () => {
  test('diff iframe styles keep addition, deletion, and hunk rows visible', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'src/web/components/CommitsTab.svelte'), 'utf-8');

    expect(source).toContain('.hljs-addition');
    expect(source).toContain('background: #dafbe1');
    expect(source).toContain('color: #116329');
    expect(source).toContain('.hljs-deletion');
    expect(source).toContain('background: #ffebe9');
    expect(source).toContain('color: #82071e');
    expect(source).toContain('.hljs-meta');
    expect(source).toContain('display: block');
  });

  test('recent commit rows use high-contrast text tokens', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'src/web/components/CommitsTab.svelte'), 'utf-8');

    expect(source).toContain('.commit-subject-line');
    expect(source).toContain('color: var(--text-header)');
    expect(source).toContain('.commit-meta-line');
    expect(source).toContain('color: var(--text-muted)');
  });
});
