// Напоминание, тип задачи и дата создания в интерфейсе: поле в панели задачи и в форме записи, значки в строке и на карточке
import { CalendarPlus, CheckSquare, Users } from "lucide-react";
import type { Task, TaskKind } from "./db";
import { fmtDay, stampDay, stampTime } from "./dates";
import { REMIND_BEFORE, REMIND_OFF, setBefore, setCustom, type When } from "./remind";
import { TimeInput, Toggle } from "./widgets";
import { Chip } from "./extras";
import "./taskbits.css";

/** Напоминание: да/нет, при «да» за сколько до задачи или своё время */
export function RemindField(props: {
  value: When;
  defaultBefore: number;
  reminded?: boolean;
  disabled?: boolean;
  onChange: (p: Partial<Task>) => void;
}) {
  const x = props.value;
  const on = !!x.remind_at;
  const custom = on && x.remind_before == null;
  return (
    <>
      <Toggle label="Напоминание" on={on} disabled={props.disabled}
        onChange={(v) => props.onChange(v ? setBefore(x, props.defaultBefore) : REMIND_OFF)} />
      {on && (
        <>
          <select className="field remind-sel" aria-label="Когда напомнить" disabled={props.disabled} value={custom ? "custom" : String(x.remind_before)}
            onChange={(e) => props.onChange(e.target.value === "custom" ? setCustom(x) : setBefore(x, Number(e.target.value)))}>
            {REMIND_BEFORE.map((o) => <option key={o.value} value={o.value}>{o.name}</option>)}
            <option value="custom">своё время</option>
          </select>
          {custom && (
            <TimeInput value={stampTime(x.remind_at!)} disabled={props.disabled}
              onCommit={(t) => props.onChange(t ? setCustom(x, t) : REMIND_OFF)} />
          )}
          <span className="hint">
            {fmtDay(stampDay(x.remind_at!))} в {stampTime(x.remind_at!)}{props.reminded ? ", уже пришло" : ""}
            {!x.start_time && !custom ? ". Без времени считаем от 9:00" : ""}
          </span>
        </>
      )}
    </>
  );
}

export const KINDS: { id: TaskKind; name: string; accent: string }[] = [
  { id: "task", name: "Задача", accent: "graphite" },
  { id: "meeting", name: "Встреча", accent: "violet" },
];

export const KindIcon = ({ kind, size = 12 }: { kind: TaskKind; size?: number }) =>
  kind === "meeting" ? <Users size={size} /> : <CheckSquare size={size} />;

/** Тип: обычная задача или встреча (звонок с клиентом, с командой) */
export function KindSwitch(props: { value: TaskKind; onChange: (k: TaskKind) => void }) {
  return (
    <>
      {KINDS.map((k) => (
        <Chip key={k.id} on={props.value === k.id} accent={k.accent} onClick={() => props.onChange(k.id)}>
          <KindIcon kind={k.id} /> {k.name}
        </Chip>
      ))}
    </>
  );
}

/** Значок встречи перед названием в строке, на карточке и в календаре. У обычных задач ничего */
export function MeetingMark({ task }: { task: Task }) {
  if (task.kind !== "meeting") return null;
  return <span className="meeting-mark" data-tip="Встреча" aria-label="Встреча"><Users size={12} /></span>;
}

/** «Пт, 16 окт в 14:30» */
export const fmtCreated = (stamp: string) => `${fmtDay(stampDay(stamp))} в ${stampTime(stamp)}`;

/** Дата создания в строке и на карточке: день, а полностью в подсказке */
export function CreatedMeta({ task }: { task: Task }) {
  return (
    <span className="meta created" data-tip={`Создана ${fmtCreated(task.created_at).toLowerCase()}`}>
      <CalendarPlus size={11} /> {fmtDay(stampDay(task.created_at))}
    </span>
  );
}
