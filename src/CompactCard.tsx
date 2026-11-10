import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check, ExternalLink, X } from "lucide-react";
import { openUrl, type Project, type Task } from "./db";
import { fmtDay, fmtRange, fmtStamp, stampDay, stampTime, today } from "./dates";
import { tips } from "./fields";
import { cardShown, dueLabel, type CardField } from "./compactLists";
import { Assignee } from "./PersonCard";
import { TagChips } from "./TagsUI";
import { QuadrantGlyph } from "./extras";
import { QUADRANTS } from "./quadrants";
import { PriorityIcon, priorityName } from "./priority";
import { stageOf, STAGES } from "./boardOps";
import { Icon } from "./icons";
import { describe, parseRule } from "./recurrence";
import { RELATION_NAMES } from "./relations";
import { CreatedMeta, DueFlag, KindIcon, WaitingBadge } from "./TaskBits";
import { hasDue } from "./due";

/*
 * Карточка задачи в компактном окне. Открывается кликом по строке (наведение только подсвечивает строку),
 * закрывается крестиком, Esc или кликом вне её (за этим следит Compact.tsx). Показывает всё, что заполнено у задачи,
 * кроме полей, которые выключены в настройках компактного вида (compact:card). Теги, люди и значки те же,
 * что в главном окне, поэтому подсказки и карточка человека при наведении работают так же.
 */

export interface CardAnchor {
  task: Task;
  top: number; // верх и низ строки в окне
  bottom: number;
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="cv-pop-row">
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
);

export default function TaskCard(props: {
  anchor: CardAnchor;
  project?: Project;
  settings: Record<string, string>;
  onClose: () => void;
  onOpen: (id: number) => void;
  onSub: (subId: number, done: boolean) => void;
}) {
  const { anchor, project, settings } = props;
  const x = anchor.task;
  const box = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number | null>(null);
  // Под строкой, а если внизу не хватает места — над ней. Размер меняется, когда отмечают пункт чеклиста
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const h = el.offsetHeight;
    const room = window.innerHeight - 14;
    const below = anchor.bottom + 4;
    setTop(below + h <= room ? below : Math.max(14, anchor.top - 4 - h));
  }, [anchor, x]);

  const on = cardShown(settings);
  const show = (id: CardField) => on(id);
  const done = x.status === "done" || x.status === "archived";
  const overdue = x.status === "active" && !!x.due_date && x.due_date < today();
  const st = STAGES.find((s) => s.key === stageOf(x));
  const rule = parseRule(x.recurrence);
  const quadrant = x.quadrant ? QUADRANTS[x.quadrant - 1] : undefined;
  const date = dueLabel({ due_date: x.due_date, start_time: null, end_time: null });

  return (
    <div ref={box} className="cv-pop" style={{ top: top ?? 0, visibility: top == null ? "hidden" : "visible" }} role="dialog" aria-label="Карточка задачи"
      onPointerDown={(e) => e.stopPropagation()}>
      <div className="cv-pop-head">
        <div className="cv-pop-title">{x.title || "Без названия"}</div>
        <button type="button" className="cv-mini" data-tip="Открыть в главном окне" aria-label="Открыть в главном окне" onClick={() => props.onOpen(x.id)}><ExternalLink size={13} /></button>
        <button type="button" className="cv-mini" data-tip="Закрыть" data-key="Esc" aria-label="Закрыть" onClick={props.onClose}><X size={14} /></button>
      </div>
      <div className="cv-pop-body">
        {((show("stage") && st) || (show("kind") && x.kind === "meeting") || (show("tags") && x.tags.length > 0)) && (
          <div className="cv-pop-chips">
            {show("stage") && st && (x.status !== "archived" || !!x.cancelled) && (
              <span className="stage" data-tip={tips.stage(x)} style={{ "--c": `var(--${st.accent})` } as React.CSSProperties}><Icon name={st.icon} size={11} /> {st.name}</span>
            )}
            {show("kind") && x.kind === "meeting" && <span className="meta" data-tip={tips.meeting(x)}><KindIcon kind="meeting" /> Встреча</span>}
            {show("tags") && <TagChips tags={x.tags} max={x.tags.length} />}
          </div>
        )}
        <dl className="cv-pop-rows">
          {show("date") && x.due_date && <Row label="Дата"><span className={`meta ${overdue ? "overdue" : ""}`} data-tip={tips.date(x, overdue)}>{date}</span></Row>}
          {show("time") && x.start_time && <Row label="Время"><span className="meta" data-tip={tips.time(x)}>{fmtRange(x.start_time, x.end_time)}</span></Row>}
          {show("due") && hasDue(x) && <Row label="Срок"><DueFlag task={x} /></Row>}
          {show("remind") && x.remind_at && <Row label="Напоминание"><span className="meta" data-tip={tips.remind(x)}>⏰ {fmtDay(stampDay(x.remind_at))}, {stampTime(x.remind_at)}</span></Row>}
          {show("repeat") && rule && <Row label="Повтор"><span className="meta" data-tip={tips.repeat(x)}>{describe(rule)}</span></Row>}
          {show("priority") && x.priority > 0 && (
            <Row label="Важность"><span className="cv-val" data-tip={tips.priority(x.priority)}><PriorityIcon p={x.priority} /> {priorityName(x.priority)}</span></Row>
          )}
          {show("matrix") && quadrant && x.quadrant && (
            <Row label="Матрица"><span className="cv-val" data-tip={tips.matrix(x.quadrant)}><QuadrantGlyph q={x.quadrant} /> {quadrant.name}</span></Row>
          )}
          {show("space") && project && (
            <Row label="Пространство">
              <span className="tag" data-tip={tips.space(project.name)} style={{ background: `var(--${project.color})`, color: `var(--${project.color}-ink, var(--on-acc))` }}>{project.name}</span>
            </Row>
          )}
          {show("waiting") && x.waiting_for && <Row label="Жду"><WaitingBadge task={x} />{done && <span className="meta">{x.waiting_for}</span>}</Row>}
          {show("assignee") && x.assigned_by && <Row label="Кто назначил"><Assignee name={x.assigned_by} /></Row>}
          {show("participants") && x.participants.length > 0 && (
            <Row label="Участники"><span className="cv-people">{x.participants.map((n) => <Assignee key={n} name={n} />)}</span></Row>
          )}
          {show("relations") && x.relations.length > 0 && (
            <Row label="Связи">
              <span className="cv-list-col">
                {x.relations.map((r, i) => (
                  <span key={i} className={`cv-rel${r.other_closed ? " closed" : ""}`} data-tip={`${RELATION_NAMES[r.kind]}: ${r.other_title}`}>
                    <span className="meta">{RELATION_NAMES[r.kind].toLowerCase()}</span> {r.other_title}
                  </span>
                ))}
              </span>
            </Row>
          )}
          {show("links") && x.links.length > 0 && (
            <Row label="Ссылки">
              <span className="cv-list-col">
                {x.links.map((l) => (
                  <a key={l.id} href={l.url} className="cv-link" title={l.url} onClick={(e) => (e.preventDefault(), openUrl(l.url).catch(() => {}))}>{l.title || l.url}</a>
                ))}
              </span>
            </Row>
          )}
          {show("files") && x.files.length > 0 && (
            <Row label="Файлы"><span className="cv-list-col">{x.files.map((f) => <span key={f.id} className="cv-file" data-tip={f.name}>{f.name}</span>)}</span></Row>
          )}
        </dl>
        {show("checklist") && x.subtasks.length > 0 && (
          <div className="cv-pop-sub">
            <div className="cv-pop-lbl" data-tip={tips.checklist(x)}>Чеклист {x.subtasks.filter((s) => s.done).length}/{x.subtasks.length}</div>
            {x.subtasks.map((s) => (
              <button type="button" key={s.id} className={`cv-pop-item${s.done ? " done" : ""}`} role="checkbox" aria-checked={!!s.done}
                onClick={() => props.onSub(s.id, !s.done)}>
                <span className="cl-box">{s.done ? <Check size={10} strokeWidth={3.4} /> : null}</span>
                <span className="cv-pop-it">{s.title}</span>
              </button>
            ))}
          </div>
        )}
        {show("note") && x.note.trim() && <div className="cv-pop-note">{x.note.trim()}</div>}
        {show("summary") && x.summary.trim() && (
          <div className="cv-pop-note"><div className="cv-pop-lbl">Итоги</div>{x.summary.trim()}</div>
        )}
        {(show("created") || (show("triaged") && x.triaged_at)) && (
          <div className="cv-pop-foot">
            {show("created") && <CreatedMeta task={x} label />}
            {show("triaged") && x.triaged_at && <span className="meta" data-tip={`Разобрана ${fmtStamp(x.triaged_at)}`}>разобрана {fmtDay(stampDay(x.triaged_at)).toLowerCase()}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
