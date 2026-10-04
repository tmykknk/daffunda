CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  group_id TEXT NOT NULL CHECK (length(group_id) > 0),
  name TEXT NOT NULL CHECK (length(name) > 0),
  norm_name TEXT NOT NULL CHECK (length(norm_name) > 0),
  added_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  done_at TEXT
);
CREATE INDEX items_group_active_name ON items (group_id, done_at, norm_name);
CREATE TABLE reminders (
  id INTEGER PRIMARY KEY,
  group_id TEXT NOT NULL CHECK (length(group_id) > 0),
  content TEXT NOT NULL CHECK (length(content) > 0),
  remind_at TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'canceled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  retry_key TEXT,
  sent_at TEXT,
  updated_at TEXT,
  claim_token TEXT
);
CREATE INDEX reminders_status_due ON reminders (status, remind_at);
CREATE TABLE processed_events (
  event_id TEXT PRIMARY KEY NOT NULL CHECK (length(event_id) > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
