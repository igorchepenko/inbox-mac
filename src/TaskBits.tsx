// Напоминание, тип задачи и дата создания в интерфейсе: поле в панели задачи и в форме записи, значки в строке и на карточке
import { BellRing, CalendarPlus, CheckSquare, FlagTriangleRight, Hourglass, Users } from "lucide-react";
import { isWaiting, pingDue, presetDate, WAIT_PRESETS, CLEAR_WAITING } from "./waiting";
import { PersonInput } from "./TagsUI";
import type { Task, TaskKind } from "./db";
import { fmtDay, fmtStamp, stampDay, stampTime } from "./dates";
import { anchorOf, REMIND_BEFORE, REMIND_OFF, setBefore, setCustom, type When } from "./remind";
import { dueState, hasDue, type DueTask } from "./due";
import { TimeInput, Toggle } from "./widgets";
import { Chip, DateField } from "./extras";
import { tips } from "./fields";
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
  return <span className="meeting-mark" data-tip={tips.meeting(task)} aria-label="Встреча"><Users size={12} /></span>;
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
  return (
    <span className={`meta due ${state ?? ""}`} data-tip={tips.due(x)}>
      <FlagTriangleRight size={11} /> {day ? `${fmtDay(x.due_date!)} ` : ""}до {x.end_time}
    </span>
  );
}

/** Статус «Жду» в строке и на карточке: у кого ждём, а в день напоминания «пора напомнить» */
export function WaitingBadge({ task: x }: { task: Task }) {
  if (!isWaiting(x)) return null;
  const ping = pingDue(x);
  return (
    <span className={`meta waiting ${ping ? "ping" : ""}`} data-tip={tips.waiting(x)}>
      {ping ? <BellRing size={11} /> : <Hourglass size={11} />} {ping ? "Пора напомнить" : `Жду: ${x.waiting_for}`}
    </span>
  );
}

/** Поле «Жду» в панели задачи: от кого, когда напомнить, «Пришёл ответ» возвращает задачу в работу */
export function WaitingField(props: {
  task: Task;
  people: string[];
  disabled?: boolean;
  onPatch: (p: Pick<Task, "waiting_for" | "waiting_until">) => void;
}) {
  const x = props.task;
  const on = isWaiting(x);
  const set = (waiting_until: string | null) => props.onPatch({ waiting_for: x.waiting_for, waiting_until });
  return (
    <>
      <PersonInput value={x.waiting_for} people={props.people} disabled={props.disabled} placeholder="От кого жду, например Андрей"
        onChange={(v) => props.onPatch(v ? { waiting_for: v, waiting_until: x.waiting_until } : CLEAR_WAITING)} />
      {on && (
        <>
          <div className="lbl sub-lbl">Напомнить <span className="opt">необязательно</span></div>
          <div className="seg">
            {WAIT_PRESETS.map((p) => {
              const d = presetDate(p.days);
              return <Chip key={p.days} accent="move" on={x.waiting_until === d} onClick={() => set(x.waiting_until === d ? null : d)}>{p.name}</Chip>;
            })}
            <DateField value={x.waiting_until} onChange={set} accent="move" />
          </div>
          {pingDue(x) && <div className="hint wait-ping">Пора напомнить: {x.waiting_for} ждёт тебя в «Сегодня»</div>}
          <div className="row-btns"><button type="button" className="btn" disabled={props.disabled} onClick={() => props.onPatch(CLEAR_WAITING)}>Пришёл ответ</button></div>
        </>
      )}
    </>
  );
}
