import { Link2, Paperclip, Repeat, Users } from "lucide-react";
import type { Project, Task } from "./db";
import { fmtDay, fmtRange, stampTime, today } from "./dates";
import { tips, type Shown } from "./fields";
import { Assignee } from "./PersonCard";
import { TagChips } from "./TagsUI";
import { QuadrantGlyph } from "./extras";
import { PriorityIcon } from "./priority";
import { stageOf, STAGES } from "./boardOps";
import { Icon } from "./icons";
import { ChecklistBadge, CreatedMeta, DueFlag, MeetingMark, RelationBadges, WaitingBadge } from "./TaskBits";

/*
 * Параметры задачи в строке компактного окна. Те же значки и подсказки, что в строке главного окна (TaskRow в App.tsx),
 * но какие из них видны, решает Shown из настроек компактного вида (compact:row), а не «Поля задач» главного окна.
 * Названия и галочки здесь нет: их рисует сама строка.
 */

/** Значок встречи перед названием */
export const RowMark = ({ task, show }: { task: Task; show: Shown }) => (show("kind") ? <MeetingMark task={task} /> : null);

/** Всё, что идёт после названия: теги, статус, значки, время, срок, важность, этап, пространство, дата */
export function RowMeta({ task: x, project, show, onSub }: { task: Task; project?: Project; show: Shown; onSub: (subId: number, done: boolean) => void }) {
  const done = x.status === "done" || x.status === "archived";
  const overdue = x.status === "active" && !!x.due_date && x.due_date < today();
  const st = STAGES.find((s) => s.key === stageOf(x));
  return (
    <>
      {show("tags") && <TagChips tags={x.tags} max={2} />}
      <WaitingBadge task={x} />
      <RelationBadges task={x} />
      {show("assignee") && x.assigned_by && <Assignee name={x.assigned_by} />}
      {show("participants") && x.participants.length > 0 && (
        <span className="meta badge" data-tip={tips.participants(x.participants)}><Users size={12} /> {x.participants.length}</span>
      )}
      {show("checklist") && <ChecklistBadge task={x} onToggle={onSub} />}
      {show("links") && x.links.length > 0 && <span className="meta badge" data-tip={tips.links(x)}><Link2 size={12} />{x.links.length > 1 ? ` ${x.links.length}` : ""}</span>}
      {show("files") && x.files.length > 0 && <span className="meta badge" data-tip={tips.files(x)}><Paperclip size={12} />{x.files.length > 1 ? ` ${x.files.length}` : ""}</span>}
      {show("repeat") && x.recurrence && !done && <span className="meta badge" data-tip={tips.repeat(x)}><Repeat size={12} /></span>}
      {show("matrix") && x.quadrant && !done && <span className="tipped" data-tip={tips.matrix(x.quadrant)}><QuadrantGlyph q={x.quadrant} /></span>}
      {show("time") && x.start_time && <span className="meta" data-tip={tips.time(x)}>{fmtRange(x.start_time, x.end_time)}</span>}
      {show("due") && <DueFlag task={x} />}
      {show("remind") && x.remind_at && !x.reminded && !done && <span className="meta" data-tip={tips.remind(x)}>⏰ {stampTime(x.remind_at)}</span>}
      {show("priority") && x.priority > 0 && !done && <span className="tipped" data-tip={tips.priority(x.priority)}><PriorityIcon p={x.priority} /></span>}
      {show("stage") && st && (x.status !== "archived" || !!x.cancelled) && (
        <span className="stage" data-tip={tips.stage(x)} style={{ "--c": `var(--${st.accent})` } as React.CSSProperties}><Icon name={st.icon} size={11} /> {st.name}</span>
      )}
      {show("space") && project && <span className="tag" data-tip={tips.space(project.name)} style={{ background: `var(--${project.color})`, color: `var(--${project.color}-ink, var(--on-acc))` }}>{project.name}</span>}
      {show("date") && x.due_date && <span className={`meta ${overdue ? "overdue" : ""}`} data-tip={tips.date(x, overdue)}>{fmtDay(x.due_date)}</span>}
      {show("created") && <CreatedMeta task={x} />}
    </>
  );
}
