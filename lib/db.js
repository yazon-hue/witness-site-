// SQLite via Node's built-in node:sqlite (Node 22.13+). No dependencies.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      wallet TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      bio TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      last_seen INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS nonces (
      nonce TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS investigations (
      id INTEGER PRIMARY KEY,
      author_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      wallet TEXT NOT NULL,
      chain TEXT NOT NULL DEFAULT 'Solana',
      category TEXT NOT NULL,
      interpretation TEXT NOT NULL,
      speculation TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_inv_created ON investigations(created_at DESC);
    CREATE TABLE IF NOT EXISTS evidence (
      id INTEGER PRIMARY KEY,
      investigation_id INTEGER NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      signature TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      onchain_ok INTEGER,          -- NULL = not checked yet, 1 = found & succeeded, 0 = not found / failed
      involves_wallet INTEGER,     -- 1 if the investigated wallet appears in the transaction
      block_time INTEGER,
      created_at INTEGER NOT NULL,
      UNIQUE (investigation_id, signature)
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY,
      investigation_id INTEGER NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      verdict TEXT NOT NULL CHECK (verdict IN ('confirm', 'challenge')),
      comment TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      UNIQUE (investigation_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      wallet TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      UNIQUE (user_id, wallet)
    );
    CREATE TABLE IF NOT EXISTS launches (
      id INTEGER PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      creator_wallet TEXT NOT NULL,
      mint TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      symbol TEXT NOT NULL,
      image TEXT NOT NULL DEFAULT '',
      signature TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}
