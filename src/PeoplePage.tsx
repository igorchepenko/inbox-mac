import { useEffect, useMemo, useRef, useState } from "react";
import { PickBox } from "./components";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Briefcase, Building2, Check, Gift, Keyboard, ListChecks, ListFilter, Phone, Rows3, Send, UserRound, Users, X } from "lucide-react";
import * as db from "./db";
import type { Person, PersonFields, Tag, Task } from "./db";
import {
  activeCount, assignedCount, birthdayInYear, distinctValues, EMPTY_PEOPLE_FILTER, filterPeople, fmtBirthday, formatBirthday, hiddenPeopleFields, NEW_PERSON_EVENT,
  normalizeTelegram, PEOPLE_FIELDS, PEOPLE_FIELDS_KEY, PEOPLE_SORTS, peopleColumns, peopleDirection, peopleFilterCount, parseBirthday, searchPeople, sortPeople,
  taskCount, togglePeopleField, waitingCount, type PeopleFilter, type PeopleSort,
} from "./people";
import { MONTHS_SHORT, today } from "./dates";
import { plural } from "./views";
import { sameName } from "./tags";
import { profileKey } from "./profile";
import { Line } from "./extras";
import { SearchField, TagChip, TagInput } from "./TagsUI";
import { CloseX, Popover, Toggle, useAutosize } from "./widgets";

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

const SORT_ICONS: Record<PeopleSort, React.ReactNode> = {
  name: <UserRound size={14} />,
  birthday: <Gift size={14} />,
  company: <Building2 size={14} />,
  job: <Briefcase size={14} />,
  active: <ListChecks size={14} />,
};

/** Сортировка, как в «Задачах»: значки по видам, повторный клик по выбранной и стрелка разворачивают порядок */
function PeopleSortSwitch({ value, rev, onChange, onReverse }: { value: PeopleSort; rev: boolean; onChange: (s: PeopleSort) => void; onReverse: () => void }) {
  const dir = peopleDirection(value, rev);
  const other = peopleDirection(value, !rev);
  const tip = (s: (typeof PEOPLE_SORTS)[number]) =>
    s.id !== value ? `${s.name}. ${s.hint}` : `${s.name}, ${dir.asc ? "по возрастанию" : "по убыванию"}: ${dir.text}. Нажми ещё раз: ${other.text}`;
  return (
    <div className="sort-switch">
      <div className="theme-switch layout-switch" role="radiogroup" aria-label="Сортировка">
        {PEOPLE_SORTS.map((s) => (
          <button key={s.id} role="radio" aria-checked={value === s.id} aria-label={s.name} data-tip={tip(s)}
            className={value === s.id ? "on" : ""} onClick={() => (value === s.id ? onReverse() : onChange(s.id))}>{SORT_ICONS[s.id]}</button>
        ))}
      </div>
      <button className="icon-btn sort-dir" aria-label={dir.asc ? "По возрастанию" : "По убыванию"}
        data-tip={`${dir.asc ? "По возрастанию" : "По убыванию"}: ${dir.text}. Нажми: ${other.text}`} onClick={onReverse}>
        {dir.asc ? <ArrowUpNarrowWide size={14} /> : <ArrowDownWideNarrow size={14} />}
      </button>
    </div>
  );
}

const toggleIn = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

/** Фильтры людей: компания, должность и теги, внутри группы подходит любой из выбранных */
function PeopleFilterButton(props: { filter: PeopleFilter; companies: string[]; jobs: string[]; tags: Tag[]; onChange: (f: PeopleFilter) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { filter: f } = props;
  const n = peopleFilterCount(f);
  const group = (label: string, values: string[], on: string[], key: "companies" | "jobs", empty: string) => (
    <>
      <div className="lbl sub-lbl">{label} <span className="opt">любая из выбранных</span></div>
      <div className="seg">
        {values.map((v) => (
          <button type="button" key={v} className={`fchip person ${on.includes(v) ? "on" : ""}`} onClick={() => props.onChange({ ...f, [key]: toggleIn(on, v) })}>{v}</button>
        ))}
        {!values.length && <span className="hint">{empty}</span>}
      </div>
    </>
  );
  return (
    <>
      <button className={`icon-btn ${n ? "on" : ""}`} data-tip="Фильтры по компании, должности и тегам" onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
        <ListFilter size={13} /> Фильтры{n > 0 && <span className="fcount">{n}</span>}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={320}>
          {group("Компания", props.companies, f.companies, "companies", "Компании ещё не указаны ни у кого")}
          {group("Должность", props.jobs, f.jobs, "jobs", "Должности ещё не указаны ни у кого")}
          <div className="lbl sub-lbl">Теги <span className="opt">люди с любым из выбранных</span></div>
          <div className="seg">
            {props.tags.map((t) => (
              <button type="button" key={t.id} className={`fchip ${f.tags.includes(t.id) ? "on" : ""}`} onClick={() => props.onChange({ ...f, tags: toggleIn(f.tags, t.id) })}>
                <TagChip name={t.name} color={t.color} />
              </button>
            ))}
            {!props.tags.length && <span className="hint">Тегов пока нет</span>}
          </div>
          {n > 0 && <button type="button" className="link tag-del" onClick={() => props.onChange(EMPTY_PEOPLE_FILTER)}>Сбросить фильтры</button>}
        </Popover>
      )}
    </>
  );
}

/** Что сейчас отфильтровано: под шапкой, у каждого условия крестик */
function PeopleFilterBar(props: { filter: PeopleFilter; tags: Tag[]; shown: number; onChange: (f: PeopleFilter) => void }) {
  const { filter: f } = props;
  if (!peopleFilterCount(f)) return null;
  const chip = (key: string, icon: React.ReactNode, text: string, label: string, remove: () => void) => (
    <span key={key} className="fchip person on static">
      {icon} {text}
      <button type="button" className="tchip-x" aria-label={`Убрать ${label}`} onClick={remove}><X size={10} strokeWidth={2.6} /></button>
    </span>
  );
  return (
    <div className="filter-bar">
      <ListFilter size={13} />
      {f.companies.map((c) => chip(`c${c}`, <Building2 size={11} />, c, c, () => props.onChange({ ...f, companies: f.companies.filter((x) => x !== c) })))}
      {f.jobs.map((j) => chip(`j${j}`, <Briefcase size={11} />, j, j, () => props.onChange({ ...f, jobs: f.jobs.filter((x) => x !== j) })))}
      {f.tags.map((id) => {
        const t = props.tags.find((x) => x.id === id);
        return t && <TagChip key={id} name={t.name} color={t.color} onRemove={() => props.onChange({ ...f, tags: f.tags.filter((x) => x !== id) })} />;
      })}
      <span className="meta">{props.shown ? `показано ${plural(props.shown, "человек", "человека", "человек")}` : "ничего не подходит"}</span>
      <button type="button" className="link" onClick={() => props.onChange(EMPTY_PEOPLE_FILTER)}>сбросить</button>
    </div>
  );
}

/** Кнопка «Поля»: что показывать в строке списка людей. Отдельно от полей задач */
function PeopleFieldsButton(props: { settings: Record<string, string>; onSet: (key: string, value: string) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const hidden = hiddenPeopleFields(props.settings);
  return (
    <>
      <button className={`icon-btn ${hidden.length ? "on" : ""}`} data-tip="Какие поля человека видны в списке" onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
        <Rows3 size={13} /> Поля
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={300}>
          <div className="lbl">Поля в списке <span className="opt">имя видно всегда</span></div>
          <div className="pf-list">
            {PEOPLE_FIELDS.map((f) => (
              <div key={f.id} className="pf-row">
                <div className="set-text"><div className="set-name">{f.name}</div><div className="hint">{f.hint}</div></div>
                <Toggle label={`${f.name}: показывать в списке`} on={!hidden.includes(f.id)}
                  onChange={(on) => props.onSet(PEOPLE_FIELDS_KEY, togglePeopleField(props.settings, f.id, on))} />
              </div>
            ))}
          </div>
          {hidden.length > 0 && <button type="button" className="link tag-del" onClick={() => props.onSet(PEOPLE_FIELDS_KEY, "[]")}>Показать все</button>}
        </Popover>
      )}
    </>
  );
}

/** Раздел «Люди»: все, кто ставит задачи и ходит на встречи. Поиск, сортировка, фильтры, массовые действия */
export default function PeoplePage(props: {
  people: Person[];
  tasks: Task[];
  tags: Tag[];
  settings: Record<string, string>;
  onSetting: (key: string, value: string) => void;
  /** Открыть сочетания клавиш */
  onShortcuts: () => void;
  /** Перечитать всё после правки в базе */
  reload: () => Promise<unknown>;
  /** Человек, карточку которого открыть сразу (например, с дня рождения в календаре) */
  focus?: string | null;
  onFocused?: () => void;
  /** Клик по дню рождения: календарь открывается на этом дне (ГГГГ-ММ-ДД) в режиме «Месяц» */
  onOpenBirthday?: (day: string) => void;
  /** Клик по числу задач: список «Задачи», отфильтрованный по человеку (назначил или жду от) */
  onOpenTasks?: (name: string, kind: "by" | "wait") => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PeopleSort>(() => loadPref(KEY_SORT, PEOPLE_SORTS.map((s) => s.id), "name"));
  const [rev, setRev] = useState(() => loadPref(KEY_REV, ["0", "1"] as const, "0") === "1");
  const [filter, setFilter] = useState<PeopleFilter>(EMPTY_PEOPLE_FILTER);
  const [picked, setPicked] = useState<number[]>([]);
  const [dlg, setDlg] = useState<Dlg | null>(null);
  // Что только что скопировали по клику: на секунду вместо текста показываем «Скопировано»
  const [copied, setCopied] = useState<string | null>(null);
  const copyTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);
  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(key);
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(null), 1200);
  };

  useEffect(() => {
    if (!props.focus) return;
    const p = props.people.find((x) => sameName(x.name, props.focus!));
    if (p) setDlg({ kind: "edit", person: p });
    props.onFocused?.();
  }, [props.focus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Клавиша N в разделе «Люди» записывает человека, как в «Задачах» задачу
  useEffect(() => {
    const open = () => setDlg({ kind: "edit", person: null });
    window.addEventListener(NEW_PERSON_EVENT, open);
    return () => window.removeEventListener(NEW_PERSON_EVENT, open);
  }, []);

  const active = useMemo(() => new Map(props.people.map((p) => [p.id, activeCount(p.name, props.tasks)])), [props.people, props.tasks]);
  const counts = useMemo(() => new Map(props.people.map((p) => [p.id, taskCount(p.name, props.tasks)])), [props.people, props.tasks]);
  const shown = useMemo(
    () => sortPeople(filterPeople(searchPeople(query, props.people), filter), sort, rev, active),
    [props.people, query, filter, sort, rev, active]);
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
    const key = (e: KeyboardEvent) => {
      if (dlg) return;
      if (e.key === "Escape") setPicked([]);
      else if (e.metaKey && e.code === "KeyA" && !(e.target as HTMLElement).closest("input, textarea, select")) (e.preventDefault(), setPicked(shown.map((p) => p.id)));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [ids.length, dlg, shown]);
  const setSortSaved = (s: PeopleSort) => (setSort(s), savePref(KEY_SORT, s));
  const toggleRev = () => (setRev(!rev), savePref(KEY_REV, rev ? "0" : "1"));
  const withBirthday = props.people.filter((p) => p.birthday).length;
  const companies = useMemo(() => distinctValues(props.people.map((p) => p.company)), [props.people]);
  const jobs = useMemo(() => distinctValues(props.people.map((p) => p.job_title)), [props.people]);
  const hidden = hiddenPeopleFields(props.settings);

  return (
    <div className="pp people">
      <header className="head" data-tauri-drag-region>
        <span className="head-icon" style={{ color: "var(--stand)" }}><Users size={24} /></span>
        <div className="head-text">
          <h2>Люди</h2>
          <p className="head-sub">
            {props.people.length ? plural(props.people.length, "человек", "человека", "человек") : "Пока никого"}
            {withBirthday > 0 && <> · дней рождения: {withBirthday}</>}
          </p>
        </div>
        <div className="head-tools">
          <SearchField value={query} onChange={setQuery} placeholder="Найти человека" tip="Поиск по имени" />
          <PeopleSortSwitch value={sort} rev={rev} onChange={setSortSaved} onReverse={toggleRev} />
          <PeopleFilterButton filter={filter} companies={companies} jobs={jobs} tags={props.tags} onChange={setFilter} />
          <PeopleFieldsButton settings={props.settings} onSet={props.onSetting} />
          <button className="icon-btn" data-tip="Сочетания клавиш" data-key="⌘/" aria-label="Сочетания клавиш" onClick={props.onShortcuts}><Keyboard size={14} /></button>
        </div>
      </header>

      <PeopleFilterBar filter={filter} tags={props.tags} shown={shown.length} onChange={setFilter} />

      <button className="add field" onClick={() => setDlg({ kind: "edit", person: null })}>
        + Записать человека <kbd>N</kbd>
      </button>

      {ids.length > 0 && (
        <div className="ppl-bulk">
          <b>Выбрано: {ids.length}</b>
          <button className="btn small" onClick={() => setDlg({ kind: "bulk" })}>Изменить</button>
          <button className="btn small danger" onClick={() => setDlg({ kind: "delete", ids })}>Удалить</button>
          {!allOn && <button className="link" onClick={() => setPicked(shown.map((p) => p.id))}>Выбрать всех{query.trim() ? " найденных" : ""} <kbd>⌘A</kbd></button>}
          <button className="link" onClick={() => setPicked([])}>Снять выбор <kbd>Esc</kbd></button>
        </div>
      )}

      <div className={`ppl-list ${ids.length ? "has-pick" : ""} ${hidden.map((h) => `no-${h}`).join(" ")}`} style={{ "--ppl-cols": peopleColumns(hidden) } as React.CSSProperties}>
        {shown.map((p) => (
          <div key={p.id} className={`ppl-row ${ids.includes(p.id) ? "on" : ""}`} role="button" tabIndex={0}
            onClick={(e) => (e.shiftKey ? span(p.id) : e.metaKey || e.ctrlKey ? toggle(p.id) : setDlg({ kind: "edit", person: p }))} onKeyDown={(e) => e.key === "Enter" && setDlg({ kind: "edit", person: p })}>
            <PickBox checked={ids.includes(p.id)} label={`Выбрать ${p.name}`} onToggle={() => toggle(p.id)} />
            <span className="ppl-ava"><UserRound size={15} /></span>
            <div className="ppl-main">
              <b className="ppl-name" title={p.name}>{p.name}</b>
              {(p.job_title || p.company) && (
                <span className="ppl-work">
                  <Briefcase size={11} />
                  {p.job_title && <span className="ppl-job" data-tip={p.job_title}>{p.job_title}</span>}
                  {p.job_title && p.company && <span className="ppl-sep">·</span>}
                  {p.company && <span className="ppl-co"><Building2 size={11} /><span data-tip={p.company}>{p.company}</span></span>}
                </span>
              )}
            </div>
            <div className="ppl-tags">{p.tags.map((t) => <TagChip key={t.id} name={t.name} color={t.color} />)}</div>
            <div className="ppl-contacts">
              {p.phone && (
                <button type="button" className="ppl-copy" data-tip="Скопировать номер" onClick={(e) => (e.stopPropagation(), copy(`ph${p.id}`, p.phone))}>
                  {copied === `ph${p.id}` ? <><Check size={11} /> Скопировано</> : <><Phone size={11} /> {p.phone}</>}
                </button>
              )}
              {p.telegram && (
                <button type="button" className="ppl-copy" data-tip="Скопировать Telegram" onClick={(e) => (e.stopPropagation(), copy(`tg${p.id}`, `@${p.telegram}`))}>
                  {copied === `tg${p.id}` ? <><Check size={11} /> Скопировано</> : <><Send size={11} /> @{p.telegram}</>}
                </button>
              )}
            </div>
            <span className="ppl-bday">
              {p.birthday && (
                <button type="button" className="ppl-copy" data-tip="Показать в календаре"
                  onClick={(e) => (e.stopPropagation(), props.onOpenBirthday?.(birthdayInYear(p.birthday, Number(today().slice(0, 4)))!))}>
                  <Gift size={12} /> {fmtBirthday(p.birthday)}
                </button>
              )}
            </span>
            <span className="ppl-n">
              {assignedCount(p.name, props.tasks) > 0 && (
                <button type="button" className="ppl-copy" data-tip="Открыть задачи, которые он назначил"
                  onClick={(e) => (e.stopPropagation(), props.onOpenTasks?.(p.name, "by"))}>
                  назначил: {assignedCount(p.name, props.tasks)}
                </button>
              )}
              {waitingCount(p.name, props.tasks) > 0 && (
                <button type="button" className="ppl-copy" data-tip="Открыть задачи, где жду ответа от него"
                  onClick={(e) => (e.stopPropagation(), props.onOpenTasks?.(p.name, "wait"))}>
                  жду: {waitingCount(p.name, props.tasks)}
                </button>
              )}
            </span>
          </div>
        ))}
        {!props.people.length && (
          <div className="pp-none">Здесь будут все, кто ставит тебе задачи и ходит на встречи. Имя появится само, когда впишешь его в задачу или наберёшь @Имя при записи. Можно записать и вручную: кнопка выше или клавиша N.</div>
        )}
        {(query.trim() || peopleFilterCount(filter) > 0) && !shown.length && props.people.length > 0 && (
          <div className="pp-none">{query.trim() ? "Никого не нашлось. Ищу по имени." : "С такими фильтрами людей нет."}</div>
        )}
      </div>

      {dlg?.kind === "edit" && (
        <PersonDialog key={dlg.person?.id ?? "new"} person={dlg.person} tags={props.tags} taskN={dlg.person ? counts.get(dlg.person.id) ?? 0 : 0}
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

/**
 * Карточка человека, создание и правка: та же форма, что у записи задачи. Сверху имя и комментарий, ниже по ⌘E параметры.
 * Новому параметры свёрнуты, при правке раскрыты. Ошибку (имя уже занято) показывает сама
 */
function PersonDialog(props: {
  person: Person | null;
  tags: Tag[];
  taskN: number;
  onClose: () => void;
  onSaved: () => void;
  onDelete?: () => void;
}) {
  const p = props.person;
  const b = parseBirthday(p?.birthday);
  const [f, setF] = useState<PersonFields>({
    name: p?.name ?? "", phone: p?.phone ?? "", telegram: p?.telegram ? `@${p.telegram}` : "", comment: p?.comment ?? "", birthday: p?.birthday ?? null,
    company: p?.company ?? "", job_title: p?.job_title ?? "", tags: p?.tags.map((t) => t.name) ?? [],
  });
  const [day, setDay] = useState(b ? String(b.day) : "");
  const [month, setMonth] = useState(b ? String(b.month) : "");
  const [year, setYear] = useState(b?.year ? String(b.year) : "");
  const [more, setMore] = useState(!!p);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const note = useRef<HTMLTextAreaElement>(null);
  useAutosize(note, f.comment, 260);
  useEffect(() => nameRef.current?.focus(), []);

  // Дата рождения собирается из трёх полей; несуществующая (31 апреля) не принимается
  const bday = formatBirthday(Number(day) || null, Number(month) || null, Number(year) || null);
  const partial = !!(day || month || year);
  const bdayBad = partial && !bday;
  const set = (patch: Partial<PersonFields>) => (setF({ ...f, ...patch }), setError(null));
  const filled = [f.company, f.job_title, f.phone, f.telegram].filter((v) => v.trim()).length + (f.tags.length ? 1 : 0) + (partial ? 1 : 0);

  const save = async () => {
    if (busy) return;
    if (!f.name.trim()) return nameRef.current?.focus();
    if (bdayBad) return setMore(true);
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
  const onKey = (e: React.KeyboardEvent) => {
    // Клавиши формы не должны доходить до списка
    if (e.key === "Escape" || e.key === "Enter") e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    }
    if (e.metaKey && e.code === "KeyE") {
      e.preventDefault();
      setMore((m) => !m);
    }
    // Enter в имени сохраняет, в комментарии нужен ⌘Enter, в остальных полях Enter только подтверждает поле
    if (e.key === "Enter") {
      if (e.target === nameRef.current || e.metaKey) {
        e.preventDefault();
        save();
      } else if ((e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
    }
  };
  const clearBday = () => (setDay(""), setMonth(""), setYear(""), setError(null));

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <form className="qi person-qi" onSubmit={(e) => (e.preventDefault(), save())} onKeyDown={onKey}>
        <CloseX onClick={props.onClose} />
        <input ref={nameRef} className="field qi-title" placeholder="Имя" data-tip={p ? "Если изменить имя, оно изменится и во всех его задачах" : undefined} value={f.name} maxLength={60} autoComplete="off" spellCheck={false}
          onChange={(e) => set({ name: e.target.value })} />
        <textarea ref={note} rows={2} className="field qi-note" placeholder="Комментарий, если нужен: что важно помнить об этом человеке" value={f.comment}
          onChange={(e) => set({ comment: e.target.value })} />
        {more && (
          <div className="qi-more lines">
            <Line label="Компания"><input className="field pd-in" value={f.company} onChange={(e) => set({ company: e.target.value })} /></Line>
            <Line label="Должность"><input className="field pd-in" value={f.job_title} onChange={(e) => set({ job_title: e.target.value })} /></Line>
            <Line label="Телефон"><input className="field pd-in" type="tel" value={f.phone} placeholder="+7 900 000-00-00" onChange={(e) => set({ phone: e.target.value })} /></Line>
            <Line label="Telegram"><input className="field pd-in" value={f.telegram} placeholder="@ник" spellCheck={false} onChange={(e) => set({ telegram: e.target.value })} /></Line>
            <Line label="Теги"><TagInput value={f.tags} tags={props.tags} onChange={(tags) => set({ tags })} /></Line>
            <Line label="День рождения">
              <div className={`pd-bday ${bdayBad ? "bad" : ""}`}>
                <input inputMode="numeric" placeholder="День" aria-label="День" maxLength={2} value={day} className="pd-d"
                  onChange={(e) => (setDay(e.target.value.replace(/\D/g, "")), setError(null))} />
                <select aria-label="Месяц" value={month} className="pd-m" onChange={(e) => (setMonth(e.target.value), setError(null))}>
                  <option value="">Месяц</option>
                  {MONTHS_SHORT.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
                <input inputMode="numeric" placeholder="Год" aria-label="Год" maxLength={4} value={year} className="pd-y"
                  onChange={(e) => (setYear(e.target.value.replace(/\D/g, "")), setError(null))} />
                {partial && <button type="button" className="pd-x" aria-label="Очистить день рождения" data-tip="Очистить" onClick={clearBday}><X size={12} /></button>}
              </div>
              <span className="hint">{bday ? fmtBirthday(bday) : "год можно не указывать"}</span>
            </Line>
            {bdayBad && <div className="error">Проверь дату: нужны день и месяц, и такой даты в календаре нет{Number(year) > MAX_YEAR ? " (год из будущего)" : ""}.</div>}
          </div>
        )}
        {error && <div className="error">{error}</div>}
        <div className="qi-foot">
          <button type="button" className={`more-btn ${more ? "on" : ""}`} onClick={() => setMore((m) => !m)} data-tip="Компания, должность, телефон, Telegram, теги, день рождения" data-key="⌘E">
            {more ? "Скрыть параметры" : filled ? `Параметры · ${filled}` : "+ Компания, телефон, день рождения…"}
          </button>
          {props.onDelete && <button type="button" className="link danger" onClick={props.onDelete}>Удалить</button>}
          <span className="grow" />
          {p && props.taskN > 0 && <span>{plural(props.taskN, "задача", "задачи", "задач")}</span>}
          <button className="cta" type="submit" disabled={busy}>Сохранить ⏎</button>
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
      <form className="qi person-qi" onSubmit={(e) => (e.preventDefault(), apply())} onKeyDown={(e) => e.key === "Escape" && props.onClose()}>
        <CloseX onClick={props.onClose} />
        <h3 className="bulk-h">Изменить: {plural(props.count, "человек", "человека", "человек")}</h3>
        <p className="hint">Заполни только то, что нужно поменять у всех. Пустые поля остаются как есть, теги добавляются к тем, что уже стоят.</p>
        <div className="qi-more lines">
          <Line label="Компания"><input className="field pd-in" autoFocus value={company} onChange={(e) => setCompany(e.target.value)} /></Line>
          <Line label="Должность"><input className="field pd-in" value={job} onChange={(e) => setJob(e.target.value)} /></Line>
          <Line label="Теги"><TagInput value={tags} tags={props.tags} onChange={setTags} /></Line>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="qi-foot">
          <span className="grow" />
          <button type="button" className="btn" onClick={props.onClose}>Отмена</button>
          <button type="submit" className="cta" disabled={!ready}>Применить</button>
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
