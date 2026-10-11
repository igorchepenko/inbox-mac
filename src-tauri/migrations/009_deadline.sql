-- Дедлайн задачи: крайний срок, отдельно от даты и времени «от–до».
-- День YYYY-MM-DD или момент YYYY-MM-DDTHH:MM, если указано время. NULL — без дедлайна
ALTER TABLE tasks ADD COLUMN deadline TEXT;
-- Уведомление о приближении дедлайна уже пришло. Сбрасывается, когда дедлайн меняют
ALTER TABLE tasks ADD COLUMN deadline_notified INTEGER NOT NULL DEFAULT 0;
