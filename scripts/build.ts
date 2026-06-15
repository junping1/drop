#!/usr/bin/env bun

/**
 * Build script: compiles Svelte frontend, embeds assets, and produces a standalone binary.
 *
 * Usage: bun run scripts/build.ts [--target <target>] [--skip-web]
 * Targets: linux-x64 (default), linux-arm64, darwin-x64, darwin-arm64
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const projectRoot = join(import.meta.dir, '..');
const distDir = join(projectRoot, 'dist');
const target = process.argv.includes('--target')
  ? process.argv[process.argv.indexOf('--target') + 1]
  : 'linux-x64';
const skipWeb = process.argv.includes('--skip-web');

if (skipWeb) {
  console.log('1/3 Reusing existing Svelte frontend build...');
} else {
  console.log('1/3 Building Svelte frontend...');
  execSync('bun run build:web', { cwd: projectRoot, stdio: 'inherit' });
}

console.log('2/3 Embedding frontend assets...');
const appJs = readFileSync(join(distDir, 'web', 'app.js'), 'utf-8');
let appCss = '';
try {
  appCss = readFileSync(join(distDir, 'web', 'app.css'), 'utf-8');
} catch { /* no separate CSS */ }

// Generate a module that exports the embedded assets
const embeddedModule = `// Auto-generated — do not edit
export const SVELTE_JS = ${JSON.stringify(appJs)};
export const SVELTE_CSS = ${JSON.stringify(appCss)};
`;

mkdirSync(join(distDir, 'generated'), { recursive: true });
writeFileSync(join(distDir, 'generated', 'embedded-assets.ts'), embeddedModule);

console.log(`3/3 Compiling binary for ${target}...`);
const outName = target.startsWith('darwin') ? 'drop' : `drop-${target}`;
execSync(
  `bun build --compile --target=bun-${target} --outfile=${join(distDir, outName)} ${join(projectRoot, 'src/cli/index.ts')}`,
  { cwd: projectRoot, stdio: 'inherit' },
);

console.log(`\nDone! Binary: dist/${outName}`);
