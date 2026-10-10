ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN icon TEXT NOT NULL DEFAULT 'folder';

UPDATE projects SET icon = 'briefcase' WHERE name = 'Работа';
UPDATE projects SET icon = 'users' WHERE name = 'Команда';
UPDATE projects SET icon = 'house' WHERE name = 'Дом';

-- Настройки приложения: тема, иконки пунктов меню и всё, что появится дальше
CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
