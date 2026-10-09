CREATE TABLE projects (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    color      TEXT    NOT NULL DEFAULT 'stand', -- move | exercise | stand
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE tasks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT    NOT NULL,
    note       TEXT    NOT NULL DEFAULT '',
    status     TEXT    NOT NULL DEFAULT 'inbox', -- inbox | active | done | archived
    priority   INTEGER NOT NULL DEFAULT 0,       -- 0 не задана, 1 низкая, 2 средняя, 3 высокая
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    due_date   TEXT,                             -- YYYY-MM-DD
    remind_at  TEXT,                             -- YYYY-MM-DDTHH:MM, местное время
    reminded   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL,
    triaged_at TEXT,
    done_at    TEXT
);

CREATE INDEX idx_tasks_status ON tasks(status);

INSERT INTO projects (name, color, position) VALUES
    ('Работа', 'move', 1),
    ('Команда', 'stand', 2),
    ('Дом', 'exercise', 3);
