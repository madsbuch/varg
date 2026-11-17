-- Programs Mímir wrote with the owner: a Template as JSON, decoded
-- strictly by the app on every load.
CREATE TABLE programs (
  id TEXT PRIMARY KEY NOT NULL,
  template TEXT NOT NULL,
  saved_at TEXT NOT NULL
);

-- The conversation with Mímir: what the owner sees (items) and what the
-- model sees (messages), each row one JSON value in order.
CREATE TABLE mimir_items (
  id TEXT PRIMARY KEY NOT NULL,
  seq INTEGER NOT NULL,
  body TEXT NOT NULL
);
CREATE TABLE mimir_messages (
  id TEXT PRIMARY KEY NOT NULL,
  seq INTEGER NOT NULL,
  body TEXT NOT NULL
);

-- Generated audio (battle tracks, songs, voice lines): paid for once,
-- kept for good. `store` names the cache, `key` the file in it.
CREATE TABLE blobs (
  store TEXT NOT NULL,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  mime TEXT NOT NULL,
  created_at TEXT NOT NULL,
  bytes BLOB NOT NULL,
  PRIMARY KEY (store, key)
);
