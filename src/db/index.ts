import { Database } from 'bun:sqlite';
import { existsSync } from 'fs';
import { DB_PATH, ensureStateDir } from '../shared/constants.js';

let db: Database | null = null;
let dbInitialized = false;

function getDbPath(): string {
  return process.env.DROP_DB || DB_PATH;
}

function ensureTables(database: Database): void {
  if (dbInitialized) return;

  database.exec(`
    CREATE TABLE IF NOT EXISTS authorizations (
      token TEXT PRIMARY KEY,
      filepath TEXT NOT NULL,
      filename TEXT NOT NULL,
      created_at REAL NOT NULL,
      expires_at REAL NOT NULL,
      live INTEGER NOT NULL DEFAULT 0
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS git_authorizations (
      token TEXT PRIMARY KEY,
      repo_path TEXT NOT NULL,
      commit_hash TEXT NOT NULL,
      created_at REAL NOT NULL,
      expires_at REAL NOT NULL
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS dir_authorizations (
      token TEXT PRIMARY KEY,
      dirpath TEXT NOT NULL,
      dirname TEXT NOT NULL,
      excludes TEXT NOT NULL,
      created_at REAL NOT NULL,
      expires_at REAL NOT NULL,
      live INTEGER NOT NULL DEFAULT 0
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS share_aliases (
      slug TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('file', 'dir', 'git')),
      token TEXT NOT NULL,
      created_at REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_share_aliases_token ON share_aliases(token);
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS access_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL,
      share_type TEXT NOT NULL,
      event_type TEXT NOT NULL,
      outcome TEXT NOT NULL,
      created_at REAL NOT NULL,
      client_hash TEXT,
      ua_kind TEXT,
      referer_origin TEXT,
      target_path_hash TEXT,
      target_ext TEXT
    )
  `);

  database.exec('CREATE INDEX IF NOT EXISTS idx_access_events_token_created ON access_events (token, created_at)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_access_events_type_outcome_created ON access_events (event_type, outcome, created_at)');

  // Migrate: add live column if missing (existing databases)
  for (const table of ['authorizations', 'dir_authorizations']) {
    try {
      database.exec(`ALTER TABLE ${table} ADD COLUMN live INTEGER NOT NULL DEFAULT 0`);
    } catch {
      // column already exists
    }
  }

  dbInitialized = true;
}

export function getDb(): Database {
  if (db) return db;
  ensureStateDir();
  const dbPath = getDbPath();
  db = new Database(dbPath);
  db.exec('PRAGMA journal_mode=WAL');
  ensureTables(db);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    dbInitialized = false;
  }
}
