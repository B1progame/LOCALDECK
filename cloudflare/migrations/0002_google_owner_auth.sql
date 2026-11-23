-- Upgrade the original R2/token schema. Legacy share metadata is preserved
-- for manual R2 cleanup; those links are no longer served by the new Worker.
DROP INDEX IF EXISTS shares_expiration_idx;
DROP INDEX IF EXISTS shares_owner_idx;
ALTER TABLE shares RENAME TO legacy_shares;

CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')) DEFAULT 'active',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0)
);
CREATE INDEX shares_expiration_idx ON shares(expires_at);
CREATE INDEX shares_owner_idx ON shares(owner_id, created_at DESC);

DROP TABLE IF EXISTS upload_windows;
CREATE TABLE upload_windows (
  owner_id TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  uploads INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, window_start)
);
CREATE TABLE daily_upload_windows (
  owner_id TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  uploads INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, window_start)
);
CREATE TABLE global_upload_windows (
  window_start INTEGER PRIMARY KEY,
  uploads INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE auth_windows (
  client_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (client_hash, window_start)
);
CREATE TABLE read_windows (
  client_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  reads INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (client_hash, window_start)
);
CREATE TABLE user_storage (
  owner_id TEXT PRIMARY KEY,
  active_bytes INTEGER NOT NULL DEFAULT 0 CHECK (active_bytes >= 0 AND active_bytes <= 50331648),
  active_uploads INTEGER NOT NULL DEFAULT 0 CHECK (active_uploads >= 0 AND active_uploads <= 3)
);
CREATE TABLE storage_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0 AND reserved_bytes <= 536870912),
  active_uploads INTEGER NOT NULL DEFAULT 0 CHECK (active_uploads >= 0 AND active_uploads <= 3)
);
INSERT INTO storage_state (id, reserved_bytes, active_uploads) VALUES (1, 0, 0);
