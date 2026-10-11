-- Теги задач и «Кто назначил».
-- Тег: название 1–16 символов и цвет из палитры тегов (src/tags.ts). У задачи до 6 тегов, порядок как добавлены.
-- Имя без учёта регистра сверяется в приложении: NOCASE в SQLite не знает кириллицу

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_tags (
  task_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (task_id, tag_id)
);
CREATE INDEX IF NOT EXISTS task_tags_tag ON task_tags(tag_id);

-- Кто поставил задачу: имя как ввёл пользователь. NULL — сам себе
ALTER TABLE tasks ADD COLUMN assigned_by TEXT;
