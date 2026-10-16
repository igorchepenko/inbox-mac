import { useEffect, useMemo, useRef, useState } from "react";
import { PickBox } from "./components";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Building2, Gift, MessageCircle, Phone, Plus, UserRound } from "lucide-react";
import * as db from "./db";
import type { Person, PersonFields, Tag, Task } from "./db";
import { fmtBirthday, formatBirthday, normalizeTelegram, PEOPLE_SORTS, parseBirthday, searchPeople, sortPeople, taskCount, type PeopleSort } from "./people";
import { MONTHS_GEN } from "./dates";
import { plural } from "./views";
import { sameName } from "./tags";
import { profileKey } from "./profile";
import { SearchField, TagChip, TagInput } from "./TagsUI";
import { CloseX, useAutosize } from "./widgets";

const KEY_SORT = "people:sort";
const KEY_REV = "people:rev";

function loadPref<T extends string>(key: string, ok: readonly T[], def: T): T {
  try {
    const v = localStorage.getItem(profileKey(key)) as T | null;
    return v && ok.includes(v) ? v : def;
  } catch {
    return def;
  }
}
const savePref = (key: string, v: string) => {
  try {
    localStorage.setItem(profileKey(key), v);
  } catch { /* не страшно, просто не запомнится */ }
};

type Dlg =
  | { kind: "edit"; person: Person | null } // null — новый человек
  | { kind: "bulk" }
  | { kind: "delete"; ids: number[] };

/** Раздел «Люди»: все, кто ставит задачи и ходит на встречи. Карточка, поиск, сортировка, массовые действия */
export default function PeoplePage(props: {
  people: Person[];
  tasks: Task[];
  tags: Tag[];
  /** Перечитать всё после правки в базе */
  reload: () => Promise<unknown>;
  /** Человек, карточку которого открыть сразу (например, с дня рождения в календаре) */
  focus?: string | null;
  onFocused?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PeopleSort>(() => loadPref(KEY_SORT, PEOPLE_SORTS.map((s) => s.id), "name"));
  const [rev, setRev] = useState(() => loadPref(KEY_REV, ["0", "1"] as const, "0") === "1");
  const [picked, setPicked] = useState<number[]>([]);
  const [dlg, setDlg] = useState<Dlg | null>(null);

  useEffect(() => {
    if (!props.focus) return;
    const p = props.people.find((x) => sameName(x.name, props.focus!));
    if (p) setDlg({ kind: "edit", person: p });
    props.onFocused?.();
  }, [props.focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => sortPeople(searchPeople(query, props.people), sort, rev), [props.people, query, sort, rev]);
  // Выбранные, которых уже нет (удалили или отфильтровали), из выделения выпадают
  const ids = picked.filter((id) => props.people.some((p) => p.id === id));
  const allOn = shown.length > 0 && shown.every((p) => ids.includes(p.id));
  const toggle = (id: number) => {
    anchor.current = id;
    setPicked(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  };
  // ⇧-клик выделяет подряд от последней отмеченной строки
  const anchor = useRef<number | null>(null);
  const span = (id: number) => {
    const order = shown.map((p) => p.id);
    const [a, b] = [order.indexOf(anchor.current ?? id), order.indexOf(id)].sort((x, y) => x - y);
    setPicked(order.slice(a, b + 1));
  };
  useEffect(() => {
    if (!ids.length) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !dlg && setPicked([]);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [ids.length, dlg]);
  const counts = useMemo(() => new Map(props.people.map((p) => [p.id, taskCount(p.name, props.tasks)])), [props.people, props.tasks]);
  const setSortSaved = (s: PeopleSort) => (setSort(s), savePref(KEY_SORT, s));
  const toggleRev = () => (setRev(!rev), savePref(KEY_REV, rev ? "0" : "1"));
  const withBirthday = props.people.filter((p) => p.birthday).length;

  return (
    <div className="pp people">
      <header className="pp-head" data-tauri-drag-region>
        <div>
          <h2>Люди</h2>
          <p>
            {props.people.length ? plural(props.people.length, "человек", "человека", "человек") : "Пока никого"}
            {withBirthday > 0 && <> · дней рождения: {withBirthday}</>}
          </p>
        </div>
        <button className="cta stand narrow" onClick={() => setDlg({ kind: "edit", person: null })}><Plus size={14} /> Добавить человека</button>
      </header>

      {props.people.length > 0 && (
        <div className="ppl-tools">
          <SearchField value={query} onChange={setQuery} placeholder="Найти человека" tip="Поиск по имени, тегу, компании, должности, телефону и Telegram" />
          <select className="ppl-sort" value={sort} aria-label="Сортировка" onChange={(e) => setSortSaved(e.target.value as PeopleSort)}>
            {PEOPLE_SORTS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button className="icon-btn ppl-dir" onClick={toggleRev} aria-label="Обратный порядок"
            data-tip={sort === "birthday" ? (rev ? "С конца года" : "С 1 января") : rev ? "От Я к А" : "От А к Я"}>
            {rev ? <ArrowUpNarrowWide size={14} /> : <ArrowDownWideNarrow size={14} />}
          </button>
        </div>
      )}

      {ids.length > 0 && (
        <div className="ppl-bulk">
          <b>Выбрано: {ids.length}</b>
          <button className="btn small" onClick={() => setDlg({ kind: "bulk" })}>Изменить</button>
          <button className="btn small danger" onClick={() => setDlg({ kind: "delete", ids })}>Удалить</button>
          {!allOn && <button className="link" onClick={() => setPicked(shown.map((p) => p.id))}>Выбрать всех{query.trim() ? " найденных" : ""}</button>}
          <button className="link" onClick={() => setPicked([])}>Снять выбор <kbd>Esc</kbd></button>
        </div>
      )}

      <div className={`ppl-list ${ids.length ? "has-pick" : ""}`}>
        {shown.map((p) => (
          <div key={p.id} className={`ppl-row ${ids.includes(p.id) ? "on" : ""}`} role="button" tabIndex={0}
            onClick={(e) => (e.shiftKey ? span(p.id) : e.metaKey || e.ctrlKey ? toggle(p.id) : setDlg({ kind: "edit", person: p }))} onKeyDown={(e) => e.key === "Enter" && setDlg({ kind: "edit", person: p })}>
            <PickBox checked={ids.includes(p.id)} label={`Выбрать ${p.name}`} onToggle={() => toggle(p.id)} />
            <span className="ppl-ava"><UserRound size={15} /></span>
            <div className="ppl-main">
              <b className="ppl-name" title={p.name}>{p.name}</b>
              {(p.job_title || p.company) && (
                <span className="ppl-work"><Building2 size={11} /> {[p.job_title, p.company].filter(Boolean).join(", ")}</span>
              )}
            </div>
            <div className="ppl-tags">{p.tags.map((t) => <TagChip key={t.id} name={t.name} color={t.color} />)}</div>
            <div className="ppl-contacts">
              {p.phone && <span><Phone size={11} /> {p.phone}</span>}
              {p.telegram && <span><MessageCircle size={11} /> @{p.telegram}</span>}
            </div>
            <span className="ppl-bday">{p.birthday && <><Gift size={12} /> {fmtBirthday(p.birthday)}</>}</span>
            <span className="ppl-n" data-tip={counts.get(p.id) ? "Задач, где он назначил или участвует" : undefined}>
              {counts.get(p.id) ? plural(counts.get(p.id)!, "задача", "задачи", "задач") : ""}
            </span>
          </div>
        ))}
        {!props.people.length && (
          <div className="pp-none">Здесь будут все, кто ставит тебе задачи и ходит на встречи. Имя появится само, когда впишешь его в задачу или наберёшь @Имя при записи. Можно добавить и вручную.</div>
        )}
        {query.trim() && !shown.length && props.people.length > 0 && <div className="pp-none">Никого не нашлось. Ищу по имени, тегу, компании, должности, телефону и Telegram.</div>}
      </div>

      {dlg?.kind === "edit" && (
        <PersonDialog key={dlg.person?.id ?? "new"} person={dlg.person} people={props.people} tags={props.tags} taskN={dlg.person ? counts.get(dlg.person.id) ?? 0 : 0}
          onClose={() => setDlg(null)} onSaved={() => (setDlg(null), props.reload())}
          onDelete={dlg.person ? () => setDlg({ kind: "delete", ids: [dlg.person!.id] }) : undefined} />
      )}
      {dlg?.kind === "bulk" && (
        <BulkDialog count={ids.length} tags={props.tags} onClose={() => setDlg(null)}
          onApply={async (patch) => {
            await db.bulkUpdatePeople(ids, patch);
            setDlg(null);
            await props.reload();
          }} />
      )}
      {dlg?.kind === "delete" && (
        <DeleteDialog people={props.people.filter((p) => dlg.ids.includes(p.id))} all={props.people} tasks={props.tasks} onClose={() => setDlg(null)}
          onDelete={async (to) => {
            await db.deletePeople(dlg.ids, to);
            setDlg(null);
            setPicked([]);
            await props.reload();
          }} />
      )}
    </div>
  );
}

const MAX_YEAR = new Date().getFullYear();

/** Карточка человека: создание и правка. Ошибку (имя уже занято) показывает сама */
function PersonDialog(props: {
  person: Person | null;
  people: Person[];
  tags: Tag[];
  taskN: number;
  onClose: () => void;
  onSaved: () => void;
  onDelete?: () => void;
}) {
  const p = props.person;
  const b = parseBirthday(p?.birthday);
  const [f, setF] = useState<PersonFields>({
    name: p?.name ?? "", phone: p?.phone ?? "", telegram: p?.telegram ?? "", comment: p?.comment ?? "", birthday: p?.birthday ?? null,
    company: p?.company ?? "", job_title: p?.job_title ?? "", tags: p?.tags.map((t) => t.name) ?? [],
  });
  const [day, setDay] = useState(b ? String(b.day) : "");
  const [month, setMonth] = useState(b ? String(b.month) : "");
  const [year, setYear] = useState(b?.year ? String(b.year) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const note = useRef<HTMLTextAreaElement>(null);
  useAutosize(note, f.comment, 160);

  // Дата рождения собирается из трёх полей; несуществующая (31 апреля) не принимается
  const bday = formatBirthday(Number(day) || null, Number(month) || null, Number(year) || null);
  const partial = !!(day || month || year);
  const bdayBad = partial && !bday;
  const set = (patch: Partial<PersonFields>) => (setF({ ...f, ...patch }), setError(null));

  const save = async () => {
    if (!f.name.trim() || bdayBad || busy) return;
    setBusy(true);
    try {
      const fields = { ...f, telegram: normalizeTelegram(f.telegram), birthday: bday };
      if (p) await db.updatePerson(p.id, fields);
      else await db.addPerson(fields);
      props.onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <form className="dialog person-dlg" onSubmit={(e) => (e.preventDefault(), save())}
        onKeyDown={(e) => {
          if (e.key === "Escape") props.onClose();
          if (e.key === "Enter" && e.metaKey) save();
        }}>
        <CloseX onClick={props.onClose} />
        <h3>{p ? "Человек" : "Новый человек"}</h3>
        {p && <p className="hint">{props.taskN ? `${plural(props.taskN, "задача", "задачи", "задач")}. ` : ""}Если изменить имя, оно изменится и во всех его задачах.</p>}
        <input className="field dlg-name" autoFocus placeholder="Имя" value={f.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} />
        <div className="pd-grid">
          <label>Компания<input className="field" value={f.company} onChange={(e) => set({ company: e.target.value })} /></label>
          <label>Должность<input className="field" value={f.job_title} onChange={(e) => set({ job_title: e.target.value })} /></label>
          <label>Телефон<input className="field" type="tel" value={f.phone} placeholder="+7 900 000-00-00" onChange={(e) => set({ phone: e.target.value })} /></label>
          <label>Telegram<input className="field" value={f.telegram} placeholder="@ник" spellCheck={false} onChange={(e) => set({ telegram: e.target.value })} /></label>
        </div>
        <div className="lbl">Теги <span className="lbl-val">те же, что у задач</span></div>
        <TagInput value={f.tags} tags={props.tags} onChange={(tags) => set({ tags })} />
        <div className="lbl">День рождения <span className="lbl-val">{bday ? fmtBirthday(bday) : "год можно не указывать"}</span></div>
        <div className="pd-bday">
          <input className="field" inputMode="numeric" placeholder="День" aria-label="День" maxLength={2} value={day}
            onChange={(e) => (setDay(e.target.value.replace(/\D/g, "")), setError(null))} />
          <select className="field" aria-label="Месяц" value={month} onChange={(e) => (setMonth(e.target.value), setError(null))}>
            <option value="">Месяц</option>
            {MONTHS_GEN.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <input className="field" inputMode="numeric" placeholder="Год" aria-label="Год" maxLength={4} value={year}
            onChange={(e) => (setYear(e.target.value.replace(/\D/g, "")), setError(null))} />
          {partial && <button type="button" className="link" onClick={() => (setDay(""), setMonth(""), setYear(""))}>Очистить</button>}
        </div>
        {bdayBad && <div className="error">Проверь дату: нужны день и месяц, и такой даты в календаре нет{Number(year) > MAX_YEAR ? " (год из будущего)" : ""}.</div>}
        <div className="lbl">Комментарий</div>
        <textarea ref={note} className="field dlg-desc" rows={2} placeholder="Что важно помнить об этом человеке" value={f.comment}
          onChange={(e) => set({ comment: e.target.value })} onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && !e.metaKey && e.stopPropagation()} />
        {error && <div className="error">{error}</div>}
        <div className="dlg-foot">
          {props.onDelete && <button type="button" className="link danger" onClick={props.onDelete}>Удалить</button>}
          <span className="grow" />
          <button type="button" className="btn" onClick={props.onClose}>Отмена</button>
          <button type="submit" className="cta stand narrow" disabled={!f.name.trim() || bdayBad || busy}>Сохранить</button>
        </div>
      </form>
    </div>
  );
}

/** Массовая правка: заполненные поля ставятся всем выбранным, теги добавляются к имеющимся */
function BulkDialog(props: { count: number; tags: Tag[]; onClose: () => void; onApply: (p: { company?: string; job_title?: string; addTags?: string[] }) => Promise<void> }) {
  const [company, setCompany] = useState("");
  const [job, setJob] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const ready = !!(company.trim() || job.trim() || tags.length);
  const apply = async () => {
    if (!ready) return;
    try {
      await props.onApply({ company: company.trim() || undefined, job_title: job.trim() || undefined, addTags: tags.length ? tags : undefined });
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <form className="dialog person-dlg" onSubmit={(e) => (e.preventDefault(), apply())} onKeyDown={(e) => e.key === "Escape" && props.onClose()}>
        <CloseX onClick={props.onClose} />
        <h3>Изменить: {plural(props.count, "человек", "человека", "человек")}</h3>
        <p className="hint">Заполни только то, что нужно поменять у всех. Пустые поля остаются как есть, теги добавляются к тем, что уже стоят.</p>
        <div className="pd-grid">
          <label>Компания<input className="field" autoFocus value={company} onChange={(e) => setCompany(e.target.value)} /></label>
          <label>Должность<input className="field" value={job} onChange={(e) => setJob(e.target.value)} /></label>
        </div>
        <div className="lbl">Добавить теги</div>
        <TagInput value={tags} tags={props.tags} onChange={setTags} />
        {error && <div className="error">{error}</div>}
        <div className="dlg-foot">
          <span className="grow" />
          <button type="button" className="btn" onClick={props.onClose}>Отмена</button>
          <button type="submit" className="cta stand narrow" disabled={!ready}>Применить</button>
        </div>
      </form>
    </div>
  );
}

/** Удаление: задачи этих людей можно переназначить на другого или оставить без человека («Сам себе») */
function DeleteDialog(props: { people: Person[]; all: Person[]; tasks: Task[]; onClose: () => void; onDelete: (reassignTo: string | null) => Promise<void> }) {
  const gone = new Set(props.people.map((p) => p.id));
  const others = props.all.filter((p) => !gone.has(p.id));
  const n = props.tasks.filter((x) => props.people.some((p) => (x.assigned_by && sameName(x.assigned_by, p.name)) || x.participants.some((m) => sameName(m, p.name)))).length;
  const [mode, setMode] = useState<"move" | "none">(n && others.length ? "move" : "none");
  const [target, setTarget] = useState<string>(others[0]?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const title = props.people.length === 1 ? `Удалить «${props.people[0].name}»?` : `Удалить ${plural(props.people.length, "человека", "человек", "человек")}?`;
  const go = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await props.onDelete(n && mode === "move" ? target : null);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };
  const opt = (v: typeof mode, label: string, hint: string, extra?: React.ReactNode) => (
    <label className={mode === v ? "on" : ""}>
      <input type="radio" name="fate" checked={mode === v} onChange={() => setMode(v)} />
      <div><b>{label}</b><span className="hint">{hint}</span>{extra}</div>
    </label>
  );
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <form className="dialog" onSubmit={(e) => (e.preventDefault(), go())} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), props.onClose())}>
        <CloseX onClick={props.onClose} />
        <h3>{title}</h3>
        {props.people.length > 1 && <p className="hint">{props.people.map((p) => p.name).join(", ")}</p>}
        {n === 0 ? <p className="hint">Задач с этим именем нет. Карточка удалится целиком.</p> : (<>
          <p className="hint">Их задач: {n}. Что с ними сделать?</p>
          <div className="del-fate" role="radiogroup">
            {others.length > 0 && opt("move", "Переназначить на другого человека", "Он станет тем, кто назначил, и участником встреч вместо удалённых", mode === "move" && (
              <select className="field" value={target} aria-label="Кому переназначить" onChange={(e) => setTarget(e.target.value)}>
                {others.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
              </select>
            ))}
            {opt("none", "Оставить без человека", "У задач не будет поля «Кто назначил» (в списке «Сам себе»)")}
          </div>
        </>)}
        {error && <div className="error">{error}</div>}
        <div className="dlg-foot">
          <span className="grow" />
          <button type="button" className="btn" onClick={props.onClose}>Отмена</button>
          <button type="submit" className="btn danger-cta" autoFocus disabled={busy || (n > 0 && mode === "move" && !target)}>Удалить</button>
        </div>
      </form>
    </div>
  );
}
