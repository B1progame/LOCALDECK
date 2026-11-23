CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')) DEFAULT 'active',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0)
);

CREATE INDEX IF NOT EXISTS shares_expiration_idx ON shares(status, expires_at);

CREATE TABLE IF NOT EXISTS upload_windows (
  client_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  uploads INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (client_hash, window_start)
);
