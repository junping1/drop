export const VALID_CONFIG_KEYS = [
  'base_url', 'port', 'host', 'file_ttl', 'dir_default_ttl', 'auto_stop',
  'password', 'default_excludes', 'pygments.style', 'pygments.linenos',
] as const;

export type ConfigKey = typeof VALID_CONFIG_KEYS[number];

export function isValidConfigKey(key: string): key is ConfigKey {
  return (VALID_CONFIG_KEYS as readonly string[]).includes(key);
}

export function getConfigValue(cfg: Record<string, unknown>, key: string): unknown {
  const parts = key.split('.');
  let value: unknown = cfg;
  for (const part of parts) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as Record<string, unknown>)[part];
    if (value === undefined) return undefined;
  }
  return value;
}

function parseBoolean(key: string, value: string): boolean {
  const normalized = value.toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`${key} must be a boolean value`);
}

function parsePositiveInteger(key: string, value: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${key} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return parsed;
}

function parsePort(value: string): number {
  const port = parsePositiveInteger('port', value);
  if (port < 1 || port > 65535) throw new Error('port must be between 1 and 65535');
  return port;
}

function validateHost(value: string): string {
  if (!value || /\s/.test(value)) {
    throw new Error('host must be a non-empty string with no whitespace');
  }
  return value;
}

function validateBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('base_url must be a valid http(s) URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('base_url must use http or https');
  }
  return value.replace(/\/$/, '');
}

export function applyConfigValue(cfg: Record<string, unknown>, key: ConfigKey | string, value: string): void {
  if (!isValidConfigKey(key)) {
    throw new Error(`Unknown config key: ${key}. Valid keys: ${VALID_CONFIG_KEYS.join(', ')}`);
  }

  const parts = key.split('.');
  let target: Record<string, unknown> = cfg;
  for (const part of parts.slice(0, -1)) {
    const current = target[part];
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      target[part] = {};
    }
    target = target[part] as Record<string, unknown>;
  }

  const lastKey = parts[parts.length - 1];
  if (key === 'port') {
    target[lastKey] = parsePort(value);
  } else if (key === 'host') {
    target[lastKey] = validateHost(value);
  } else if (key === 'file_ttl' || key === 'dir_default_ttl') {
    target[lastKey] = parsePositiveInteger(key, value);
  } else if (key === 'auto_stop' || key === 'pygments.linenos') {
    target[lastKey] = parseBoolean(key, value);
  } else if (key === 'base_url') {
    target[lastKey] = validateBaseUrl(value);
  } else if (key === 'default_excludes') {
    target[lastKey] = value.split(',').map((item) => item.trim()).filter(Boolean);
  } else {
    target[lastKey] = value;
  }
}
