import { join } from 'path';
import { mkdirSync } from 'fs';
import { homedir } from 'os';

export const DEFAULT_PORT = 17173;
export const DEFAULT_HOST = '0.0.0.0';
export const DEFAULT_TTL = 86400; // 1 day
export const TOKEN_LENGTH = 16; // bytes, produces 32 hex chars (128 bits)
export const TIME_FORMAT = '%Y-%m-%d %H:%M'; // strftime-style, used via formatTime()

// Authorization lookup statuses
export const STATUS_VALID = 'valid' as const;
export const STATUS_EXPIRED = 'expired' as const;
export const STATUS_NOT_FOUND = 'not_found' as const;
export const STATUS_ACTIVE = 'active' as const;

export const DIR_TOKEN_LENGTH = 16; // bytes, produces 32 hex chars (128 bits)
export const OWNER_KEY_LENGTH = 16; // bytes, produces 32 hex chars
export const DIR_DEFAULT_TTL = 86400; // 1 day
export const BASE_DEFAULT_EXCLUDES = [
  '.git/', '__pycache__/', '.env', 'node_modules/',
  '.DS_Store', '*.pyc', '.venv/',
];
export const DEFAULT_HIDDEN_EXCLUDES = ['.*'];
export const DEFAULT_EXCLUDES = [
  ...BASE_DEFAULT_EXCLUDES,
  ...DEFAULT_HIDDEN_EXCLUDES,
];
export const MAX_DIR_FILES = 10000;
export const MAX_RENDER_SIZE = 5 * 1024 * 1024; // 5 MB
export const CLEANUP_INTERVAL = 60; // seconds between auto-stop checks

export const STATE_DIR = join(homedir(), '.drop');
export const DB_PATH = join(STATE_DIR, 'drop.db');
export const PID_PATH = join(STATE_DIR, 'drop.pid');
export const LOG_PATH = join(STATE_DIR, 'drop.log');
export const CONFIG_PATH = join(STATE_DIR, 'config.json');
export const SHARES_DIR = join(STATE_DIR, 'shares');
export const TUNNEL_URL_PATH = join(STATE_DIR, 'tunnel_url');

export const SHARE_TYPE_MAP: Record<string, string> = {
  markdown: '.md',
  code: '.txt',
  diff: '.diff',
  text: '.txt',
  python: '.py',
  javascript: '.js',
  json: '.json',
  yaml: '.yaml',
  html: '.html',
  css: '.css',
  shell: '.sh',
};

export const MAX_SHARE_SIZE = 10 * 1024 * 1024; // 10 MB max for stdin shares

export function ensureStateDir(): void {
  mkdirSync(STATE_DIR, { recursive: true });
}
