import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { Toggle } from "./Settings";

/*
 * Раздел «Главная» в настройках. Пишет в те же ключи таблицы settings, что читает главная (src/home/data.ts):
 * home:order и home:hidden (JSON-массивы id блоков), home:day_start, home:day_end, home:capacity, home:goal, home:name.
 */

// Тот же список и порядок по умолчанию, что BLOCKS в src/home/data.ts
const BLOCKS = [
  { id: "summary", name: "Итоги дня" },
  { id: "today", name: "Сегодня" },
  { id: "inbox", name: "На разбор" },
  { id: "week", name: "Ближайшие 7 дней" },
  { id: "matrix", name: "Матрица Эйзенхауэра" },
  { id: "stats", name: "Статистика" },
  { id: "projects", name: "Проекты" },
];
const IDS = BLOCKS.map((b) => b.id);

function parseIds(json: string | undefined): string[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((k) => IDS.includes(k)) : [];
  } catch {
    return [];
  }
}

/** Сохранённый порядок; блоки, которых в нём нет, встают в конец, как и на самой главной */
function orderOf(settings: Record<string, string>): string[] {
  const saved = [...new Set(parseIds(settings["home:order"]))];
  return [...saved, ...IDS.filter((k) => !saved.includes(k))];
}

function num(settings: Record<string, string>, key: string, def: number): number {
  const n = Number(settings[key]);
  return settings[key] !== undefined && Number.isFinite(n) ? n : def;
}

const hours = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

export function HomeSettings(props: { settings: Record<string, string>; onSet: (key: string, value: string) => void }) {
  const s = props.settings;
  const hidden = parseIds(s["home:hidden"]);
  // Порядок держим локально, чтобы перетаскивание шло без задержки на запись в базу
  const [order, setOrder] = useState(orderOf(s));
  useEffect(() => setOrder(orderOf(s)), [s["home:order"]]); // eslint-disable-line react-hooks/exhaustive-deps
  const [drag, setDrag] = useState<string | null>(null);
  const saveOrder = (o: string[]) => (setOrder(o), props.onSet("home:order", JSON.stringify(o)));
  const move = (id: string, to: number) => {
    const o = order.filter((k) => k !== id);
    o.splice(Math.max(0, Math.min(to, o.length)), 0, id);
    return o;
  };

  const start = num(s, "home:day_start", 9);
  const end = num(s, "home:day_end", 20);
  const [name, setName] = useState(s["home:name"] ?? "Игорь");
  const [goal, setGoal] = useState(String(num(s, "home:goal", 5)));
  const commitGoal = () => {
    const n = Math.round(Number(goal));
    if (n >= 1 && n <= 100) props.onSet("home:goal", String(n));
    else setGoal(String(num(s, "home:goal", 5)));
  };

  return (
    <div className="set-group">
      <div className="set-row">
        <div className="set-text">
          <div className="set-name">Блоки и их порядок</div>
          <div className="hint">Перетащи строку за ручку или двигай стрелками. Выключенные блоки на главной не показываются</div>
        </div>
        {(s["home:order"] || s["home:hidden"]) && (
          <button type="button" className="link" onClick={() => (saveOrder(IDS), props.onSet("home:hidden", "[]"))}>Как было</button>
        )}
      </div>
      <div className="block-list" onDragOver={(e) => e.preventDefault()}>
        {order.map((id, i) => {
          const b = BLOCKS.find((x) => x.id === id)!;
          const off = hidden.includes(id);
          return (
            <div key={id} className={`block-row ${off ? "off" : ""} ${drag === id ? "dragging" : ""}`} draggable
              onDragStart={(e) => (e.dataTransfer.setData("text/plain", id), e.dataTransfer.effectAllowed = "move", setDrag(id))}
              onDragEnter={() => drag && drag !== id && setOrder(move(drag, i))}
              onDragEnd={() => (setDrag(null), saveOrder(order))}>
              <GripVertical size={14} className="grip" />
              <span className="block-name">{b.name}</span>
              <button type="button" className="cal-nav" disabled={i === 0} aria-label="Выше" onClick={() => saveOrder(move(id, i - 1))}><ChevronUp size={14} /></button>
              <button type="button" className="cal-nav" disabled={i === order.length - 1} aria-label="Ниже" onClick={() => saveOrder(move(id, i + 1))}><ChevronDown size={14} /></button>
              <Toggle label={`Показывать «${b.name}»`} on={!off}
                onChange={(on) => props.onSet("home:hidden", JSON.stringify(on ? hidden.filter((k) => k !== id) : [...hidden, id]))} />
            </div>
          );
        })}
      </div>

      <div className="set-row">
        <div className="set-text">
          <div className="set-name">Рабочий день</div>
          <div className="hint">Границы полосы дня в блоке «Сегодня»</div>
        </div>
        <div className="seg">
          <select className="field set-select narrow" value={start} aria-label="Начало дня"
            onChange={(e) => {
              const v = Number(e.target.value);
              props.onSet("home:day_start", String(v));
              if (end <= v) props.onSet("home:day_end", String(v + 1));
            }}>
            {hours(0, 23).map((h) => <option key={h} value={h}>{h}:00</option>)}
          </select>
          <span className="hint">до</span>
          <select className="field set-select narrow" value={end} aria-label="Конец дня"
            onChange={(e) => props.onSet("home:day_end", e.target.value)}>
            {hours(start + 1, 24).map((h) => <option key={h} value={h}>{h}:00</option>)}
          </select>
        </div>
      </div>
      <div className="set-row">
        <div className="set-text">
          <div className="set-name">Сколько часов можно занять задачами</div>
          <div className="hint">Остальное время дня уходит на встречи и непредвиденное. Кольцо «занято» считается от этого числа</div>
        </div>
        <select className="field set-select narrow" value={num(s, "home:capacity", 6)} aria-label="Часов на задачи"
          onChange={(e) => props.onSet("home:capacity", e.target.value)}>
          {hours(1, 16).map((h) => <option key={h} value={h}>{h} ч</option>)}
        </select>
      </div>
      <div className="set-row">
        <div className="set-text">
          <div className="set-name">Цель на день</div>
          <div className="hint">Сколько задач хочешь закрывать в день: по ней считается кольцо «сделано»</div>
        </div>
        <input className="field set-input" inputMode="numeric" value={goal} aria-label="Цель на день"
          onChange={(e) => setGoal(e.target.value.replace(/\D/g, "").slice(0, 3))}
          onBlur={commitGoal} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLElement).blur()} />
      </div>
      <div className="set-row">
        <div className="set-text">
          <div className="set-name">Как к тебе обращаться</div>
          <div className="hint">Имя в приветствии на главной</div>
        </div>
        <input className="field set-input wide" value={name} aria-label="Имя"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => props.onSet("home:name", name.trim())}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLElement).blur()} />
      </div>
    </div>
  );
}
