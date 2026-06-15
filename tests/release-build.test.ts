import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import { join } from 'path';

describe('release asset build script', () => {
  test('dry run lists every installable release asset without compiling', () => {
    const result = spawnSync('bun', ['run', 'scripts/build-release.ts', '--dry-run'], {
      cwd: join(import.meta.dir, '..'),
      encoding: 'utf-8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('drop-linux-x64');
    expect(result.stdout).toContain('drop-linux-arm64');
    expect(result.stdout).toContain('drop-darwin-x64');
    expect(result.stdout).toContain('drop-darwin-arm64');
    expect(result.stdout.match(/bun run build:web/g)?.length).toBe(1);
    expect(result.stdout).toContain('bun run scripts/build.ts --target linux-x64');
    expect(result.stdout).toContain('bun run scripts/build.ts --target linux-x64 --skip-web');
    expect(result.stdout).toContain('bun run scripts/build.ts --target darwin-arm64 --skip-web');
    expect(result.stdout).toContain('Release assets ready:');
  });
});
