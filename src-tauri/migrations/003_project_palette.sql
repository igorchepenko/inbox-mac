-- Красный, зелёный и бирюзовый означают только системное (разбор, сделано, время).
-- Проекты переезжают на свою палитру
UPDATE projects SET color = 'violet' WHERE color = 'move';
UPDATE projects SET color = 'orange' WHERE color = 'stand';
UPDATE projects SET color = 'blue' WHERE color = 'exercise';
