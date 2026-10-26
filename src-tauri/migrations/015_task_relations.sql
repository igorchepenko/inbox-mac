-- Связи задач: «блокирует» и «связана». Одна строка на пару, направление важно только для blocks:
-- from_id блокирует to_id, для второй задачи это же «заблокирована». related хранится один раз, читается в обе стороны.
-- Таблица links занята под ссылки-URL задачи, поэтому здесь task_relations.
CREATE TABLE IF NOT EXISTS task_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL,
  to_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('blocks', 'related')),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_task_relations_from ON task_relations (from_id);
CREATE INDEX IF NOT EXISTS idx_task_relations_to ON task_relations (to_id);
