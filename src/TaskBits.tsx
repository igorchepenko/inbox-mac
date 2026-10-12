// Напоминание, тип задачи и дата создания в интерфейсе: поле в панели задачи и в форме записи, значки в строке и на карточке
import { CalendarPlus, CheckSquare, FlagTriangleRight, Users } from "lucide-react";
import type { Task, TaskKind } from "./db";
import { fmtDay, fmtStamp, stampDay, stampTime } from "./dates";
import { anchorOf, REMIND_BEFORE, REMIND_OFF, setBefore, setCustom, type When } from "./remind";
import { dueState, hasDue, type DueTask } from "./due";
import { TimeInput, Toggle } from "./widgets";
import { Chip, DateField } from "./extras";
import "./taskbits.css";

/** Напоминание: да/нет, при «да» за сколько до задачи или свой день и время */
export function RemindField(props: {
  value: When;
  defaultBefore: number;
  reminded?: boolean;
  disabled?: boolean;
  inline?: boolean; // календарь дня внутри формы, а не во всплывающем окне
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
            <option value="custom">свой день и время</option>
          </select>
          {custom && (
            <TimeInput value={stampTime(x.remind_at!)} disabled={props.disabled}
              onCommit={(t) => props.onChange(t ? setCustom(x, t) : REMIND_OFF)} />
          )}
          <span className="hint">
            {fmtDay(stampDay(x.remind_at!))} в {stampTime(x.remind_at!)}{props.reminded ? ", уже пришло" : ""}
            {!anchorOf(x) && !custom ? ". Без времени считаем от 9:00" : ""}
          </span>
          {custom && !props.disabled && (
            <div className="remind-day">
              <DateField inline={props.inline} value={stampDay(x.remind_at!)}
                onChange={(d) => d && props.onChange(setCustom(x, undefined, d))} />
            </div>
          )}
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

/** Дата создания в строке и на карточке: день, а полностью в подсказке «Создана 16.10.2026 14:30» */
export function CreatedMeta({ task }: { task: Task }) {
  return (
    <span className="meta created" data-tip={`Создана ${fmtStamp(task.created_at)}`}>
      <CalendarPlus size={11} /> {fmtDay(stampDay(task.created_at))}
    </span>
  );
}

/** Срок «до 18:00» в строке и на карточке: красный, если прошёл, янтарный, если сегодня или завтра */
export function DueFlag({ task: x, day }: { task: DueTask; day?: boolean }) {
  if (!hasDue(x)) return null;
  const state = dueState(x);
  const tip = state === "overdue" ? "Срок прошёл" : state === "soon" ? "Срок скоро" : "Срок";
  return (
    <span className={`meta due ${state ?? ""}`} data-tip={tip}>
      <FlagTriangleRight size={11} /> {day ? `${fmtDay(x.due_date!)} ` : ""}до {x.end_time}
    </span>
  );
}
