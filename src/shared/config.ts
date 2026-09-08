import { existsSync, statSync, chmodSync, readFileSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { CONFIG_PATH as DEFAULT_CONFIG_PATH, OWNER_KEY_LENGTH, ensureStateDir } from './constants.js';

// Mirrors how src/db/index.ts resolves DROP_DB: an env override takes
// priority over the default state-dir path, resolved fresh on every call so
// tests can point it at an isolated file without touching the real config.
// Exported (unlike the db module's private getDbPath) so tests can assert
// path resolution directly, without exercising any real file I/O.
export function getConfigPath(): string {
  return process.env.DROP_CONFIG || DEFAULT_CONFIG_PATH;
}

let configCache: Record<string, any> | null = null;
let configCachePath: string | null = null;
let configMtime = 0;

export function loadConfig(): Record<string, any> {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    configCache = {};
    configCachePath = configPath;
    configMtime = 0;
    return {};
  }
  const mtime = statSync(configPath).mtimeMs;
  if (configCache !== null && configCachePath === configPath && mtime === configMtime) {
    return configCache;
  }
  const text = readFileSync(configPath, 'utf-8');
  configCache = JSON.parse(text);
  configCachePath = configPath;
  configMtime = mtime;
  return configCache!;
}

export function saveConfig(cfg: Record<string, any>): void {
  ensureStateDir();
  const configPath = getConfigPath();
  const content = JSON.stringify(cfg, null, 2) + '\n';
  writeFileSync(configPath, content, 'utf-8');
  // Restrict permissions: config contains owner_key
  chmodSync(configPath, 0o600);
  // Invalidate cache
  configCache = null;
  configCachePath = null;
  configMtime = 0;
}

/**
 * A proxy (e.g. reverse proxy / CDN) is trusted to supply client-identifying
 * headers (CF-Connecting-IP, X-Forwarded-For, X-Real-IP) when either the
 * `trust_proxy` config flag is set OR the `DROP_TRUST_PROXY=1` env var is
 * set. Both the rate limiter and access logging must use this single check
 * so they agree on client identity.
 */
export function isProxyTrusted(cfg: Record<string, any> = loadConfig()): boolean {
  return cfg.trust_proxy === true || process.env.DROP_TRUST_PROXY === '1';
}

export function getOwnerKey(): string {
  const cfg = loadConfig();
  let key = cfg.owner_key as string | undefined;
  if (!key) {
    key = randomBytes(OWNER_KEY_LENGTH).toString('hex');
    cfg.owner_key = key;
    saveConfig(cfg);
  }
  return key;
}
