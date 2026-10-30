CREATE TABLE app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    store_name TEXT NOT NULL DEFAULT ''
        CHECK (length(store_name) <= 120),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

INSERT INTO app_settings (id) VALUES (1);

