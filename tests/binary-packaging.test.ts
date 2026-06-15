import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, test } from 'bun:test';

describe('binary packaging regressions', () => {
  test('code renderer does not load highlight.js theme files through runtime package resolution', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'src/server/render/code.ts'), 'utf-8');

    expect(source).not.toContain("require2.resolve('highlight.js/package.json')");
    expect(source).not.toContain('require2.resolve("highlight.js/package.json")');
    expect(source).not.toContain('readFileSync(join(hljsPath');
  });
});
