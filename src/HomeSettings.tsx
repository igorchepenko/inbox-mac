import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { ResetSection, Row, Toggle } from "./Settings";
import { moveItem, useSortable } from "./drag";
import { BLOCKS, blockOrder, DEFAULT_ORDER, hiddenBlocks, KEY_HIDDEN, KEY_ORDER, type BlockId } from "./home/data";

/*
 * Раздел «Главная» в настройках. Пишет в те же ключи таблицы settings, что читает главная (src/home/data.ts):
 * home:order и home:hidden (JSON-массивы id блоков), home:day_start, home:day_end, home:capacity, home:goal, home:name.
 */

function num(settings: Record<string, string>, key: string, def: number): number {
  const n = Number(settings[key]);
  return settings[key] !== undefined && Number.isFinite(n) ? n : def;
}

const hours = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

export function HomeSettings(props: { settings: Record<string, string>; onSet: (key: string, value: string) => void }) {
  const s = props.settings;
  const hidden = hiddenBlocks(s);
  // Порядок держим локально, чтобы перетаскивание шло без задержки на запись в базу
  const [order, setOrder] = useState(blockOrder(s));
  useEffect(() => setOrder(blockOrder(s)), [s[KEY_ORDER]]); // eslint-disable-line react-hooks/exhaustive-deps
  const blocksChanged = order.some((id, i) => id !== DEFAULT_ORDER[i]) || hidden.length > 0;
  const resetBlocks = () => (saveOrder(DEFAULT_ORDER), props.onSet(KEY_HIDDEN, "[]"));
  const saveOrder = (o: BlockId[]) => (setOrder(o), props.onSet(KEY_ORDER, JSON.stringify(o)));
  const sort = useSortable({ onDrop: (from, to) => saveOrder(moveItem(order, from, to)) });

  const start = num(s, "home:day_start", 9);
  const end = num(s, "home:day_end", 20);
  const capacity = num(s, "home:capacity", 6);
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
          <div className="hint">Перетащи строку за ручку или двигай стрелками. Выключенные блоки на дашборде не показываются</div>
          <div className="set-def">По умолчанию: <b>все блоки включены, стандартный порядок</b></div>
        </div>
        {blocksChanged && <button type="button" className="link" onClick={resetBlocks}>Сбросить</button>}
      </div>
      <div className={`block-list ${sort.dragging != null ? "sorting" : ""}`} ref={sort.listRef}>
        {order.map((id, i) => {
          const b = BLOCKS.find((x) => x.id === id)!;
          const off = hidden.includes(id);
          return (
            <div key={id} className={`block-row sort-row ${off ? "off" : ""} ${sort.dragging === i ? "lifted" : ""}`} style={sort.rowStyle(i)}>
              <span className="grip" title="Перетащи, чтобы поменять порядок" {...sort.grip(i)}><GripVertical size={14} /></span>
              <span className="block-name">{b.name}</span>
              <button type="button" className="cal-nav" disabled={i === 0} aria-label="Выше" onClick={() => saveOrder(moveItem(order, i, i - 1))}><ChevronUp size={14} /></button>
              <button type="button" className="cal-nav" disabled={i === order.length - 1} aria-label="Ниже" onClick={() => saveOrder(moveItem(order, i, i + 1))}><ChevronDown size={14} /></button>
              <Toggle label={`Показывать «${b.name}»`} on={!off}
                onChange={(on) => props.onSet(KEY_HIDDEN, JSON.stringify(on ? hidden.filter((k) => k !== id) : [...hidden, id]))} />
            </div>
          );
        })}
      </div>

      <Row name="Рабочий день" hint="Границы полосы дня в блоке «Сегодня»"
        def={{ text: "9:00 до 20:00", changed: start !== 9 || end !== 20, reset: () => (props.onSet("home:day_start", "9"), props.onSet("home:day_end", "20")) }}>
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
      </Row>
      <Row name="Сколько часов можно занять задачами"
        hint="Остальное время дня уходит на встречи и непредвиденное. Кольцо «занято» считается от этого числа"
        def={{ text: "6 ч", changed: capacity !== 6, reset: () => props.onSet("home:capacity", "6") }}>
        <select className="field set-select narrow" value={capacity} aria-label="Часов на задачи"
          onChange={(e) => props.onSet("home:capacity", e.target.value)}>
          {hours(1, 16).map((h) => <option key={h} value={h}>{h} ч</option>)}
        </select>
      </Row>
      <Row name="Цель на день" hint="Сколько задач хочешь закрывать в день: по ней считается кольцо «сделано»"
        def={{ text: "5", changed: num(s, "home:goal", 5) !== 5, reset: () => (setGoal("5"), props.onSet("home:goal", "5")) }}>
        <input className="field set-input" inputMode="numeric" value={goal} aria-label="Цель на день"
          onChange={(e) => setGoal(e.target.value.replace(/\D/g, "").slice(0, 3))}
          onBlur={commitGoal} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLElement).blur()} />
      </Row>
      <Row name="Как к тебе обращаться" hint="Имя в приветствии на дашборде"
        def={{ text: "Игорь", changed: (s["home:name"] ?? "Игорь") !== "Игорь", reset: () => (setName("Игорь"), props.onSet("home:name", "Игорь")) }}>
        <input className="field set-input wide" value={name} aria-label="Имя"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => props.onSet("home:name", name.trim())}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLElement).blur()} />
      </Row>
      <ResetSection name="Дашборд" changed={blocksChanged || start !== 9 || end !== 20 || capacity !== 6 || num(s, "home:goal", 5) !== 5 || (s["home:name"] ?? "Игорь") !== "Игорь"}
        onReset={() => {
          resetBlocks();
          setGoal("5");
          setName("Игорь");
          props.onSet("home:day_start", "9"); props.onSet("home:day_end", "20"); props.onSet("home:capacity", "6");
          props.onSet("home:goal", "5"); props.onSet("home:name", "Игорь");
        }} />
    </div>
  );
}
