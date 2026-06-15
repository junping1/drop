#!/usr/bin/env bun

/**
 * Build every installable release asset expected by install.sh.
 *
 * Usage:
 *   bun run scripts/build-release.ts
 *   bun run scripts/build-release.ts --dry-run
 */

import { execSync } from 'child_process';
import { copyFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';

type Target = {
  target: string;
  buildOutput: string;
  assetName: string;
};

const projectRoot = join(import.meta.dir, '..');
const distDir = join(projectRoot, 'dist');
const dryRun = process.argv.includes('--dry-run');

const targets: Target[] = [
  { target: 'linux-x64', buildOutput: 'drop-linux-x64', assetName: 'drop-linux-x64' },
  { target: 'linux-arm64', buildOutput: 'drop-linux-arm64', assetName: 'drop-linux-arm64' },
  { target: 'darwin-x64', buildOutput: 'drop', assetName: 'drop-darwin-x64' },
  { target: 'darwin-arm64', buildOutput: 'drop', assetName: 'drop-darwin-arm64' },
];

function run(command: string): void {
  if (dryRun) {
    console.log(command);
    return;
  }
  execSync(command, { cwd: projectRoot, stdio: 'inherit' });
}

function ensureAsset(path: string): void {
  if (!existsSync(path)) {
    throw new Error(`Expected release asset was not created: ${path}`);
  }
  if (statSync(path).size === 0) {
    throw new Error(`Release asset is empty: ${path}`);
  }
}

run('bun run build:web');

for (const entry of targets) {
  run(`bun run scripts/build.ts --target ${entry.target} --skip-web`);

  if (entry.buildOutput !== entry.assetName) {
    const from = join(distDir, entry.buildOutput);
    const to = join(distDir, entry.assetName);
    if (dryRun) {
      console.log(`cp dist/${entry.buildOutput} dist/${entry.assetName}`);
    } else {
      copyFileSync(from, to);
    }
  }
}

console.log('\nRelease assets ready:');
for (const entry of targets) {
  const assetPath = join(distDir, entry.assetName);
  if (!dryRun) {
    ensureAsset(assetPath);
  }
  console.log(`- dist/${entry.assetName}`);
}
