-- Напоминание относительно даты задачи, тип «Встреча», дедлайн уходит в дату.
-- За сколько минут до начала задачи напомнить: 5, 15, 30, 60, 1440. NULL при заданном remind_at — своё время
ALTER TABLE tasks ADD COLUMN remind_before INTEGER;
-- Тип задачи: task обычная, meeting встреча (звонок с клиентом или командой)
ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'task';
-- Дедлайна больше нет, его роль играет дата. Задачам без даты дедлайн становится датой, его время — началом.
-- Колонки deadline и deadline_notified остаются в базе, приложение их больше не читает
UPDATE tasks SET start_time = substr(deadline, 12, 5)
  WHERE deadline IS NOT NULL AND due_date IS NULL AND start_time IS NULL AND length(deadline) > 10;
UPDATE tasks SET due_date = substr(deadline, 1, 10) WHERE deadline IS NOT NULL AND due_date IS NULL;
