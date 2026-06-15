import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { directoryDefaultExcludes } from '../src/shared/excludes.js';
import { isExcluded, walkDirectory } from '../src/shared/fs.js';

function names(tree: { children?: { name: string; children?: any[] }[] }): Set<string> {
  const out = new Set<string>();
  const visit = (entry: { name: string; children?: any[] }) => {
    out.add(entry.name);
    for (const child of entry.children ?? []) visit(child);
  };
  for (const child of tree.children ?? []) visit(child);
  return out;
}

describe('directory default excludes', () => {
  test('exclude dotfiles and hidden directories by default', () => {
    const excludes = directoryDefaultExcludes(false, ['node_modules/', '.env', '.github/', '*.log']);

    expect(excludes).toContain('.*');
    expect(excludes).toContain('.env');
    expect(excludes).toContain('.github/');
    expect(excludes).toContain('node_modules/');
    expect(excludes).toContain('*.log');
  });

  test('include-hidden removes hidden defaults but keeps visible excludes', () => {
    const excludes = directoryDefaultExcludes(true);

    expect(excludes).toContain('node_modules/');
    expect(excludes).not.toContain('.*');
    expect(excludes).not.toContain('.env');
    expect(excludes).not.toContain('.git/');
    expect(excludes).not.toContain('.venv/');
  });

  test('include-hidden still respects configured default excludes', () => {
    const excludes = directoryDefaultExcludes(true, ['node_modules/', '.env', '.github/', '*.log', '.*']);

    expect(excludes).toEqual(['node_modules/', '.env', '.github/', '*.log']);
    expect(excludes).not.toContain('.*');
  });
});

describe('hidden-file exclusion matcher', () => {
  test("'.*' pattern matches dotfiles and hidden dirs but not visible names", () => {
    expect(isExcluded('.env', false, ['.*'])).toBe(true);
    expect(isExcluded('.ssh', true, ['.*'])).toBe(true);
    expect(isExcluded('.hidden.txt', false, ['.*'])).toBe(true);
    expect(isExcluded('README.md', false, ['.*'])).toBe(false);
    expect(isExcluded('src', true, ['.*'])).toBe(false);
  });
});

describe('directory walk excludes hidden files end-to-end', () => {
  test('default excludes hide nested dotfiles and hidden dirs', () => {
    const root = mkdtempSync(join(tmpdir(), 'drop-walk-hidden-'));
    try {
      writeFileSync(join(root, 'visible.txt'), 'ok');
      writeFileSync(join(root, '.env'), 'SECRET=1');
      mkdirSync(join(root, 'src'));
      writeFileSync(join(root, 'src', 'index.ts'), 'export {};');
      mkdirSync(join(root, 'src', '.ssh'));
      writeFileSync(join(root, 'src', '.ssh', 'id_rsa'), 'KEY');

      const excludes = directoryDefaultExcludes(false);
      const found = names(walkDirectory(root, excludes));

      expect(found.has('visible.txt')).toBe(true);
      expect(found.has('index.ts')).toBe(true);
      expect(found.has('.env')).toBe(false);
      expect(found.has('.ssh')).toBe(false);
      expect(found.has('id_rsa')).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
