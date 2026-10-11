// Дедлайн в интерфейсе: флажок с датой в строке и на карточке, поле в панели задачи и в форме записи
import { FlagTriangleRight } from "lucide-react";
import type { Task } from "./db";
import { stampDay } from "./dates";
import { deadlineState, deadlineTime, fmtDeadline, makeDeadline } from "./deadline";
import { DateField } from "./extras";
import { TimeInput } from "./widgets";
import "./deadline.css";

/** Флажок с датой дедлайна: красный, если срок прошёл, янтарный, если остался день */
export function DeadlineFlag({ task: x }: { task: Task }) {
  if (!x.deadline) return null;
  const state = deadlineState(x);
  const tip = state === "overdue" ? "Дедлайн прошёл" : state === "soon" ? "Дедлайн скоро" : "Дедлайн";
  return (
    <span className={`meta dl ${state ?? ""}`} title={tip}>
      <FlagTriangleRight size={11} /> {fmtDeadline(x.deadline)}
    </span>
  );
}

/** День дедлайна и необязательное время. Убрать дедлайн: снять выбранный день */
export function DeadlineField(props: { value: string | null; onChange: (v: string | null) => void; inline?: boolean; disabled?: boolean }) {
  const day = props.value ? stampDay(props.value) : null;
  const time = props.value ? deadlineTime(props.value) : null;
  return (
    <>
      <DateField inline={props.inline} accent="move" value={day} onChange={(d) => props.onChange(makeDeadline(d, time))} />
      {day && (
        <>
          <TimeInput value={time ?? ""} disabled={props.disabled} onCommit={(t) => props.onChange(makeDeadline(day, t || null))} />
          {!time && <span className="hint">время необязательно</span>}
          <button type="button" className="link" onClick={() => props.onChange(null)}>убрать</button>
        </>
      )}
    </>
  );
}
