import { useState } from "react";
import { Plus } from "lucide-react";
import type { Project } from "./db";
import { Chip } from "./extras";
import { Icon } from "./icons";

/**
 * Выбор пространства в задаче: чипы и «+ Новое». Новое создаётся по одному названию прямо здесь,
 * цвет подбирается сам, поменять его можно потом в настройках пространства. Если такое название уже есть, выбирается оно
 */
export function SpacePicker(props: {
  projects: Project[];
  value: number | null;
  onChange: (id: number | null) => void;
  onCreate?: (name: string) => Promise<number>;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const close = () => (setAdding(false), setName(""));
  const create = async () => {
    const n = name.trim().replace(/\s+/g, " ");
    if (!n || busy) return n ? undefined : close();
    const same = props.projects.find((p) => p.name.toLocaleLowerCase("ru") === n.toLocaleLowerCase("ru"));
    if (same) return props.onChange(same.id), close();
    setBusy(true);
    try {
      props.onChange(await props.onCreate!(n));
      close();
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {props.projects.map((p) => (
        <Chip key={p.id} on={props.value === p.id} accent={p.color} onClick={() => props.onChange(props.value === p.id ? null : p.id)}>
          <Icon name={p.icon} size={12} /> {p.name}
        </Chip>
      ))}
      {props.onCreate && (adding ? (
        <input className="field space-new-in" autoFocus placeholder="Название и Enter" value={name} maxLength={40} disabled={busy}
          aria-label="Название нового пространства"
          onChange={(e) => setName(e.target.value)} onBlur={() => !name.trim() && close()}
          onKeyDown={(e) => {
            // Enter и Esc принадлежат этому полю: иначе форма задачи сохранится или закроется
            if (e.key === "Enter") (e.preventDefault(), e.stopPropagation(), create());
            if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), close());
          }} />
      ) : (
        <button type="button" className="chip space-new" onClick={() => setAdding(true)} data-tip="Новое пространство">
          <Plus size={12} /> Новое
        </button>
      ))}
    </>
  );
}
