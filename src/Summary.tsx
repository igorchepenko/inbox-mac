import { useEffect, useRef, useState } from "react";
import type { Task } from "./db";
import { plural } from "./views";
import { CloseX, useAutosize } from "./widgets";

/** Что закрыли: задачи уже переведены в «Готово» или «Отменено», окно только спрашивает итоги */
export interface Closing {
  ids: number[];
  stage: "done" | "cancelled";
}

/**
 * Окно итогов при закрытии задачи: почему отменил или что получилось. Поле необязательное:
 * «Пропустить» и Esc оставляют задачу закрытой без итогов. Enter сохраняет, ⇧Enter — новая строка
 */
export function SummaryDialog(props: { closing: Closing; tasks: Task[]; onSave: (text: string) => void; onSkip: () => void }) {
  const { closing, tasks } = props;
  const first = tasks[0];
  const [text, setText] = useState(tasks.length === 1 ? first?.summary ?? "" : "");
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutosize(ref, text, 260);
  useEffect(() => {
    const el = ref.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const cancelled = closing.stage === "cancelled";
  const what = tasks.length === 1 ? `«${first?.title ?? ""}»` : plural(tasks.length, "задача", "задачи", "задач");
  const save = () => (text.trim() ? props.onSave(text.trim()) : props.onSkip());
  const onKey = (e: React.KeyboardEvent) => {
    // Клавиши окна не должны доходить до списка: Enter там «разобрал» бы задачу, Space отметил бы сделанной
    e.stopPropagation();
    if (e.key === "Escape") return e.preventDefault(), props.onSkip();
    if (e.key === "Enter" && !e.shiftKey) return e.preventDefault(), save();
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onSkip()}>
      <div className={`sum-dlg ${cancelled ? "cancelled" : ""}`} role="dialog" aria-label="Итоги" onKeyDown={onKey}>
        <CloseX onClick={props.onSkip} />
        <div className="sum-head">
          <span className="sum-badge">{cancelled ? "Отменено" : "Готово"}</span>
          <span className="sum-what">{what}</span>
        </div>
        <div className="lbl">Итоги <span className="opt">необязательно</span></div>
        <textarea ref={ref} rows={3} className="field sum-text" value={text} onChange={(e) => setText(e.target.value)}
          placeholder={cancelled ? "Почему отменил: передумал, неактуально, сделал кто-то другой…" : "Что получилось, к чему пришли, что дальше…"} />
        <div className="sum-foot">
          <span className="hint">⏎ сохранить, ⇧⏎ новая строка. Итоги можно поправить в панели задачи</span>
          <span className="grow" />
          <button type="button" className="btn" onClick={props.onSkip}>Пропустить <kbd>Esc</kbd></button>
          <button type="button" className={`cta narrow ${cancelled ? "muted" : "go"}`} onClick={save}>Сохранить ⏎</button>
        </div>
      </div>
    </div>
  );
}
