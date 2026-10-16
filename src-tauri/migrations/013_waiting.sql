-- Статус «Жду»: задача ждёт ответа или выполнения от другого человека.
-- waiting_for — имя из общего списка людей (тот же, что «Кто назначил»), NULL — задача не ждёт никого.
-- waiting_until — день, когда напомнить: в этот день задача возвращается в «Сегодня» с пометкой «пора напомнить»
ALTER TABLE tasks ADD COLUMN waiting_for TEXT;
ALTER TABLE tasks ADD COLUMN waiting_until TEXT;
