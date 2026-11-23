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

CREATE TABLE IF NOT EXISTS user_storage (
  owner_id TEXT PRIMARY KEY,
  active_bytes INTEGER NOT NULL DEFAULT 0 CHECK (active_bytes >= 0 AND active_bytes <= 50331648),
  active_uploads INTEGER NOT NULL DEFAULT 0 CHECK (active_uploads >= 0 AND active_uploads <= 3)
);

CREATE TABLE IF NOT EXISTS storage_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0 AND reserved_bytes <= 536870912),
  active_uploads INTEGER NOT NULL DEFAULT 0 CHECK (active_uploads >= 0 AND active_uploads <= 3)
);

INSERT OR IGNORE INTO storage_state (id, reserved_bytes, active_uploads) VALUES (1, 0, 0);
