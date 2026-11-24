CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')) DEFAULT 'active',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0)
);

CREATE INDEX IF NOT EXISTS shares_expiration_idx ON shares(expires_at);

CREATE INDEX IF NOT EXISTS shares_owner_idx ON shares(owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS share_meta (
  id TEXT PRIMARY KEY,
  parts INTEGER NOT NULL DEFAULT 1,
  received INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0,
  last_download INTEGER
);

CREATE TABLE IF NOT EXISTS accounts (
  owner_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  sign_ins INTEGER NOT NULL DEFAULT 0,
  uploads INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  limits TEXT
);

CREATE TABLE IF NOT EXISTS daily_stats (
  day INTEGER PRIMARY KEY,
  uploads INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0,
  sign_ins INTEGER NOT NULL DEFAULT 0,
  accounts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS service_settings (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  admin TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS upload_windows (
  owner_id TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  uploads INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, window_start)
);

CREATE TABLE IF NOT EXISTS daily_upload_windows (
  owner_id TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  uploads INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, window_start)
);

CREATE TABLE IF NOT EXISTS global_upload_windows (
  window_start INTEGER PRIMARY KEY,
  uploads INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS auth_windows (
  client_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (client_hash, window_start)
);

CREATE TABLE IF NOT EXISTS read_windows (
  client_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  reads INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (client_hash, window_start)
);

CREATE TABLE IF NOT EXISTS verification_mails (
  owner_id TEXT PRIMARY KEY,
  sent_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mail_windows (
  window_start INTEGER PRIMARY KEY,
  sent INTEGER NOT NULL DEFAULT 0
);
