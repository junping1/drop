/**
 * Pure helper: maps a host platform/arch pair to a `bun build --compile` target.
 *
 * Falls back to `linux-x64` (with a warning) for hosts we don't recognise.
 */

const FALLBACK_TARGET = 'linux-x64';

export function resolveHostTarget(platform: string, arch: string): string {
  if (platform === 'linux' && arch === 'x64') return 'linux-x64';
  if (platform === 'linux' && arch === 'arm64') return 'linux-arm64';
  if (platform === 'darwin' && arch === 'x64') return 'darwin-x64';
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64';

  console.warn(
    `Warning: unrecognised host platform/arch (${platform}/${arch}); defaulting to ${FALLBACK_TARGET}. Pass --target explicitly to override.`,
  );
  return FALLBACK_TARGET;
}
