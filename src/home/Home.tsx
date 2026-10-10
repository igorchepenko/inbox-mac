import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import type { Project, Task } from "../db";
import { addDays, fmtDay, today } from "../dates";
import { plural } from "../views";
import * as H from "./data";
import type { BlockId, DayConfig, Period } from "./data";
import "./home.css";
import { PriorityIcon } from "../priority";
import { LayoutDashboard } from "lucide-react";

export interface HomeProps {
  tasks: Task[];
  projects: Project[];
  settings: Record<string, string>;
  onOpenInbox: () => void;
  onOpenToday: () => void;
  onOpenTask: (x: Task) => void;
  onToggle: (x: Task) => void;
  onMoveToToday: (xs: Task[]) => void;
  onNewProject: () => void;
  onSaveLayout: (order: BlockId[], hidden: BlockId[]) => void;
}

export default function Home(props: HomeProps) {
  const { tasks, projects, settings } = props;
  const cfg = H.dayConfig(settings);
  const order = H.blockOrder(settings);
  const hidden = H.hiddenBlocks(settings);
  const [custOpen, setCustOpen] = useState(false);

  // Узкое окно: все блоки в одну колонку
  const gridRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < 760));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shown = order.filter((k) => !hidden.includes(k));
  const spans = narrow ? shown.map(() => 12) : H.fillRows(shown.map((k) => H.BLOCKS.find((b) => b.id === k)!.span));
  const projectOf = (x: Task) => projects.find((p) => p.id === x.project_id);
  const row = { projectOf, onToggle: props.onToggle, onOpen: props.onOpenTask };

  const render = (k: BlockId): ReactNode => {
    switch (k) {
      case "summary": return <SummaryBlock tasks={tasks} cfg={cfg} name={settings["home:name"] ?? "Игорь"} onInbox={props.onOpenInbox} onToday={props.onOpenToday} />;
      case "today": return <TodayBlock tasks={tasks} cfg={cfg} row={row} onMoveToToday={props.onMoveToToday} />;
      case "inbox": return <InboxBlock tasks={tasks} onOpen={props.onOpenInbox} onOpenTask={props.onOpenTask} />;
      case "week": return <WeekBlock tasks={tasks} cfg={cfg} row={row} />;
      case "matrix": return <MatrixBlock tasks={tasks} row={row} />;
      case "stats": return <StatsBlock tasks={tasks} projects={projects} cfg={cfg} />;
      case "projects": return <ProjectsBlock tasks={tasks} projects={projects} onNew={props.onNewProject} />;
    }
  };

  return (
    <div className="home">
      <div className="home-bar" data-tauri-drag-region>
        <div className="h-rel">
          <button className="gear h-cust-btn" aria-expanded={custOpen} aria-label="Настроить главную" data-tip="Настроить главную"
            onClick={() => setCustOpen((o) => !o)}><LayoutDashboard size={16} /></button>
          {custOpen && <Customize order={order} hidden={hidden} onSave={props.onSaveLayout} onClose={() => setCustOpen(false)} />}
        </div>
      </div>
      <div className="h-grid" ref={gridRef}>
        {shown.map((k, i) => (
          <section key={k} className={`w w-${k}`} style={{ gridColumn: `span ${spans[i]}` }}>{render(k)}</section>
        ))}
        {!shown.length && (
          <section className="w" style={{ gridColumn: "span 12" }}>
            <div className="h-note">Все блоки скрыты. Верни нужные кнопкой «Настроить главную» справа вверху.</div>
          </section>
        )}
      </div>
    </div>
  );
}

// Общие кусочки

function MiniRing({ fraction, color, size = 46 }: { fraction: number; color: string; size?: number }) {
  const r = size / 2 - 5, c = 2 * Math.PI * r, v = Math.min(1, Math.max(0, fraction));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="h-ring">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ring-track)" strokeWidth="6" />
      {v > 0 && (
        <circle className="h-arc" cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`var(--${color})`} strokeWidth="6"
          strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      )}
    </svg>
  );
}

/** Иконка пункта «Главная» в боковом меню: три вложенных мини-кольца */
/** Знак приложения «Молния»: тот же, что в Dock (src-tauri/icons/source/app-icon.svg) */
export function HomeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="100 100 824 824" aria-hidden="true">
      <rect x="100" y="100" width="824" height="824" rx="185" fill="#FA114F" />
      <path d="M270 520 L420 700 L560 470 L520 470 L640 290 L760 290 L640 450 L690 450 L440 760 Q420 785 395 760 L250 590 Q230 560 255 540 Z"
        fill="#FFFFFF" stroke="#FFFFFF" strokeWidth="24" strokeLinejoin="round" />
    </svg>
  );
}

function Head({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="w-h">
      <h3>{title}</h3>
      {children && <span className="r">{children}</span>}
    </div>
  );
}

interface RowCtx {
  projectOf: (x: Task) => Project | undefined;
  onToggle: (x: Task) => void;
  onOpen: (x: Task) => void;
}

function TaskLine({ x, row, time = true, extra }: { x: Task; row: RowCtx; time?: boolean; extra?: ReactNode }) {
  const done = H.isDone(x);
  const p = row.projectOf(x);
  return (
    <div className={`h-row ${done ? "done" : ""}`}>
      <button className={`h-chk ${done ? "on" : ""}`} aria-label={done ? "Вернуть" : "Отметить сделанной"}
        title={done ? "Вернуть" : "Сделано"} disabled={x.status === "archived"} onClick={() => row.onToggle(x)} />
      {time && <span className={`h-tm ${x.start_time ? "" : "none"}`}>{x.start_time ? H.timeRange(x) : "без времени"}</span>}
      <button className="t" title={x.title} onClick={() => row.onOpen(x)}>{x.title}</button>
      {x.priority > 0 && !done && <PriorityIcon p={x.priority} />}
      {p && <span className="tag" style={{ background: `var(--${p.color})` }}>{p.name}</span>}
      {extra}
    </div>
  );
}

// 1. Итоги дня

function SummaryBlock(props: { tasks: Task[]; cfg: DayConfig; name: string; onInbox: () => void; onToday: () => void }) {
  const s = H.summary(props.tasks);
  const st = useMemo(() => H.streak(props.tasks), [props.tasks]);
  const now = new Date();
  const t = today();
  const sortedOf = s.triagedToday + s.inbox;
  return (
    <div className="h-hero">
      <div className="h-hello">
        <h2>{H.greeting(now)}{props.name ? `, ${props.name}` : ""}</h2>
        <div className="h-date">{H.longDate(now)} · <span className="mono">{H.fmtMin(now.getHours() * 60 + now.getMinutes())}</span></div>
      </div>
      <div className="h-hero-cta">
        {s.inbox ? (
          <button className="cta narrow" onClick={props.onInbox}>Разобрать {plural(s.inbox, "задачу", "задачи", "задач")} ⏎</button>
        ) : (
          <button className="cta go narrow" onClick={props.onToday}>Всё разобрано, к делам</button>
        )}
        <div className="h-streak">
          {st.days ? <>Разбираешь входящие <b>{plural(st.days, "день", "дня", "дней")} подряд</b></> : "Серия разбора начнётся, когда «На разбор» опустеет"}
          <span className="h-dots">
            {st.week.map((f, i) => {
              const day = H.weekdayShort(addDays(t, i - 6));
              return <i key={i} className={f ? "f" : ""} title={`${day}: ${f ? "разобрано до нуля" : "не разобрано"}`} />;
            })}
          </span>
        </div>
      </div>
      <div className="h-stats">
        <button className="h-ds" onClick={props.onInbox}>
          <MiniRing fraction={sortedOf ? s.triagedToday / sortedOf : 0} color="move" />
          <div><b>{s.triagedToday} из {sortedOf}</b><span>разобрано сегодня</span></div>
        </button>
        <button className="h-ds" onClick={props.onToday}>
          <MiniRing fraction={s.planned ? s.doneToday / s.planned : 0} color="exercise" />
          <div><b>{s.doneToday} из {s.planned}</b><span>сделано из плана на сегодня</span></div>
        </button>
        <div className="h-ds">
          <MiniRing fraction={s.busy / props.cfg.capacity} color="stand" />
          <div><b>{s.busy ? H.fmtDur(s.busy) : "0 ч"}</b><span>занято из {props.cfg.capacity / 60} ч рабочего дня</span></div>
        </div>
      </div>
    </div>
  );
}

// 2. Сегодня

function TodayBlock(props: { tasks: Task[]; cfg: DayConfig; row: RowCtx; onMoveToToday: (xs: Task[]) => void }) {
  const { cfg, row } = props;
  const t = today();
  const items = H.todayItems(props.tasks);
  const timed = items.filter((x) => x.start_time && x.due_date === t);
  const free = items.filter((x) => !timed.includes(x));
  const od = H.overdue(props.tasks);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // Полоса дня растягивается, если задачи выходят за рабочие часы
  const from = Math.min(cfg.start, ...timed.map((x) => Math.floor(H.mins(x.start_time!) / 60) * 60));
  const to = Math.max(cfg.end, ...timed.map((x) => Math.ceil((H.mins(x.start_time!) + H.duration(x)) / 60) * 60));
  const pos = (m: number) => ((Math.min(Math.max(m, from), to) - from) / (to - from)) * 100;
  const next = timed.find((x) => !H.isDone(x) && H.mins(x.start_time!) + H.duration(x) > nowMin);
  const hours: number[] = [];
  for (let h = from / 60; h <= to / 60; h++) hours.push(h);

  return (
    <>
      <Head title="Сегодня">
        {next && <>Дальше: <b className="mono" style={{ color: "var(--stand)" }}>{next.start_time}</b> {next.title}</>}
      </Head>
      <div className="h-strip">
        {timed.map((x) => {
          const s = H.mins(x.start_time!), e = s + H.duration(x);
          const w = pos(e) - pos(s);
          const color = `var(--${row.projectOf(x)?.color ?? "graphite"})`;
          // Блоки правее середины раскрываются влево
          const anchor: CSSProperties = pos(s) > 55 ? { right: `${100 - pos(e)}%` } : { left: `${pos(s)}%` };
          return (
            <div key={x.id} className={`h-blk ${H.isDone(x) ? "done" : ""}`} tabIndex={0} title={`${H.timeRange(x)} ${x.title}`}
              style={{ ...anchor, width: `${w}%`, background: color, ["--bc" as string]: color, ["--w" as string]: `${w}%` } as CSSProperties}
              onDoubleClick={() => row.onOpen(x)}>
              <span className="tt">{H.timeRange(x)}</span>{x.title}
            </div>
          );
        })}
        {nowMin >= from && nowMin <= to && <div className="h-now" style={{ left: `${pos(nowMin)}%` }} title={`Сейчас ${H.fmtMin(nowMin)}`} />}
      </div>
      <div className="h-hours">{hours.map((h) => <span key={h}>{h}</span>)}</div>

      {od.length > 0 && (
        <div className="h-over">
          <div className="w-h">
            <h3 style={{ color: "var(--move)" }}>Просрочено · {od.length}</h3>
            <button className="h-link r" style={{ color: "var(--move)" }} onClick={() => props.onMoveToToday(od)}>Всё на сегодня</button>
          </div>
          <div className="h-list">
            {od.map((x) => (
              <TaskLine key={x.id} x={x} row={row} time={false} extra={<>
                <span className="h-meta">{fmtDay(x.due_date!)}</span>
                <button className="h-mini" onClick={() => props.onMoveToToday([x])}>На сегодня</button>
              </>} />
            ))}
          </div>
        </div>
      )}
      <div className="h-sub">По времени</div>
      <div className="h-list">
        {timed.map((x) => <TaskLine key={x.id} x={x} row={row} />)}
        {!timed.length && <div className="h-row empty">Нет задач со временем</div>}
      </div>
      <div className="h-sub">В течение дня</div>
      <div className="h-list">
        {free.map((x) => <TaskLine key={x.id} x={x} row={row} />)}
        {!free.length && <div className="h-row empty">Пусто</div>}
      </div>
    </>
  );
}

// 3. На разбор

function InboxBlock(props: { tasks: Task[]; onOpen: () => void; onOpenTask: (x: Task) => void }) {
  const items = H.inboxItems(props.tasks);
  const n = items.length;
  return (
    <>
      <Head title="На разбор"><button className="h-link" onClick={props.onOpen}>Открыть</button></Head>
      <div className="h-inb-top">
        <div className="h-big" style={{ color: n ? "var(--move)" : "var(--exercise)" }}>{n}</div>
        <p>
          {n ? <>Самая старая лежит <b style={{ color: items[0].age >= 2 ? "var(--amber)" : "var(--fg)" }}>{H.fmtAge(items[0].age)}</b>. Разбор займёт пару минут.</>
            : "Пусто. Всё записанное уже разобрано."}
        </p>
      </div>
      <div className="h-list">
        {items.slice(0, 4).map(({ task, age }) => (
          <div key={task.id} className="h-row">
            <button className="t" title={task.title} onClick={() => props.onOpenTask(task)}>{task.title}</button>
            <span className={`h-age ${age >= 2 ? "old" : ""}`}>{H.fmtAge(age)}</span>
          </div>
        ))}
      </div>
      {n > 0 && <button className="cta narrow h-sm" onClick={props.onOpen}>Начать разбор</button>}
    </>
  );
}

// 4. Ближайшие 7 дней

function WeekBlock(props: { tasks: Task[]; cfg: DayConfig; row: RowCtx }) {
  const days = H.nextDays(props.tasks);
  const [open, setOpen] = useState<string | null>(days[0].day);
  const sel = days.find((d) => d.day === open);
  return (
    <>
      <Head title="Ближайшие 7 дней">полоса: занятое время из {props.cfg.capacity / 60} ч</Head>
      <div className="h-week">
        {days.map((d, i) => {
          const f = Math.min(1, d.busy / props.cfg.capacity);
          return (
            <button key={d.day} className={`h-day ${open === d.day ? "on" : ""} ${H.isWeekend(d.day) ? "we" : ""}`}
              aria-pressed={open === d.day} onClick={() => setOpen(open === d.day ? null : d.day)}>
              <span className="dn">{i === 0 ? "Завтра" : H.weekdayShort(d.day)}</span>
              <span className="dd">{Number(d.day.slice(8))}</span>
              <span className="bar"><i style={{ width: `${Math.max(f * 100, d.items.length ? 6 : 0)}%`, background: `var(--${H.loadColor(f)})` }} /></span>
              <span className="cnt">{d.items.length} · {d.busy ? H.fmtDur(d.busy) : "—"}</span>
            </button>
          );
        })}
      </div>
      {sel && (
        <>
          <div className="h-sub">{fmtDay(sel.day)}</div>
          <div className="h-list">
            {sel.items.map((x) => <TaskLine key={x.id} x={x} row={props.row} />)}
            {!sel.items.length && <div className="h-row empty">Свободный день</div>}
          </div>
        </>
      )}
    </>
  );
}

// 5. Матрица Эйзенхауэра

function MatrixBlock(props: { tasks: Task[]; row: RowCtx }) {
  const open = H.matrixTasks(props.tasks);
  const [q, setQ] = useState<number | null>(null);
  const cell = ({ q: n, name, color }: (typeof H.QUADRANTS)[number]) => (
    <button key={n} className={`h-q ${q === n ? "on" : ""}`} aria-pressed={q === n} onClick={() => setQ(q === n ? null : n)}
      style={{ boxShadow: `inset 3px 0 0 var(--${color})` }}>
      <b style={{ color: `var(--${color})` }}>{open.filter((x) => x.quadrant === n).length}</b>
      <span>{name}</span>
    </button>
  );
  const items = q ? open.filter((x) => x.quadrant === q) : [];
  return (
    <>
      <Head title="Матрица Эйзенхауэра">на 7 дней</Head>
      <div className="h-mx">
        <span />
        <span className="ax">Срочно</span>
        <span className="ax">Не срочно</span>
        <span className="ax ay">Важно</span>
        {cell(H.QUADRANTS[0])}
        {cell(H.QUADRANTS[1])}
        <span className="ax ay">Не важно</span>
        {cell(H.QUADRANTS[2])}
        {cell(H.QUADRANTS[3])}
      </div>
      {q ? (
        <div className="h-list">
          {items.map((x) => <TaskLine key={x.id} x={x} row={props.row} time={false} />)}
          {!items.length && <div className="h-row empty">В этом квадранте пусто</div>}
        </div>
      ) : (
        <div className="h-note">Квадрант ставится при разборе, если хочешь. Задачи без квадранта сюда не попадают.</div>
      )}
    </>
  );
}

// 6. Статистика

function StatsBlock(props: { tasks: Task[]; projects: Project[]; cfg: DayConfig }) {
  const [period, setPeriod] = useState<Period>("week");
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const s = useMemo(() => H.stats(props.tasks, period, props.cfg), [props.tasks, period, props.cfg.goal]); // eslint-disable-line react-hooks/exhaustive-deps
  const series = [
    ...props.projects.map((p) => ({ id: p.id, name: p.name, color: p.color as string })),
    ...(s.bars.some((b) => b.byProject.get(0)) ? [{ id: 0, name: "Без проекта", color: "muted" }] : []),
  ];
  const max = Math.ceil(Math.max(s.goal, ...s.bars.map((b) => b.total)) * 1.15);
  const W = 520, Hh = 170, pl = 26, pb = 22, pt = 8;
  const cw = (W - pl) / s.bars.length, bw = Math.min(38, cw * 0.55);
  const y = (v: number) => Hh - pb - (v / max) * (Hh - pb - pt);
  const step = max > 20 ? 10 : max > 8 ? 4 : 2;
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);

  return (
    <>
      <Head title="Статистика">
        <span className="h-seg">
          <button className={period === "week" ? "on" : ""} onClick={() => setPeriod("week")}>Неделя</button>
          <button className={period === "month" ? "on" : ""} onClick={() => setPeriod("month")}>Месяц</button>
        </span>
      </Head>
      <div className="h-kpis">
        <div className="h-kpi"><b>{s.done}</b><span>сделано за {period === "week" ? "неделю" : "4 недели"}</span></div>
        <div className="h-kpi"><b>{s.onTime == null ? "—" : `${Math.round(s.onTime * 100)}%`}</b><span>сделано в срок</span></div>
        <div className="h-kpi"><b>{s.triage == null ? "—" : H.fmtHours(s.triage)}</b><span>от записи до разбора</span></div>
        <div className="h-kpi"><b>{s.planned ? H.fmtDur(s.planned) : "0 ч"}</b><span>запланировано {period === "week" ? "на неделе" : "в этом месяце"}</span></div>
      </div>
      <svg className="h-chart" viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label={`Сделано по ${period === "week" ? "дням" : "неделям"}`}
        onPointerLeave={() => setTip(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pl} x2={W} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth="1" />
            <text x={pl - 6} y={y(v) + 3} textAnchor="end">{v}</text>
          </g>
        ))}
        {s.bars.map((b, i) => {
          const x = pl + i * cw + (cw - bw) / 2;
          let acc = 0;
          const parts = series.filter((r) => b.byProject.get(r.id)).map((r) => {
            const v = b.byProject.get(r.id)!;
            const y0 = y(acc), y1 = y(acc + v);
            acc += v;
            return <rect key={r.id} x={x} y={y1} width={bw} height={Math.max(0, y0 - y1 - 1.5)} rx="3" fill={`var(--${r.color})`} />;
          });
          const text = `${b.label}: ${b.total} сделано` +
            (b.total ? " · " + series.filter((r) => b.byProject.get(r.id)).map((r) => `${r.name} ${b.byProject.get(r.id)}`).join(", ") : "");
          return (
            <g key={i}>
              {parts}
              <rect x={pl + i * cw} y={pt} width={cw} height={Hh - pb - pt} fill="transparent"
                onPointerMove={(e) => setTip({ text, x: e.clientX, y: e.clientY })} />
              <text x={x + bw / 2} y={Hh - 6} textAnchor="middle" className={b.current ? "cur" : ""}>{b.label}</text>
            </g>
          );
        })}
        <line x1={pl} x2={W} y1={y(s.goal)} y2={y(s.goal)} className="goal-line" />
        <g className="goal-tag" transform={`translate(${W - 4} ${y(s.goal)})`}>
          <rect x="-58" y="-18" width="58" height="16" rx="8" />
          <text x="-29" y="-6.5" textAnchor="middle">цель {s.goal}</text>
        </g>
      </svg>
      <div className="h-legend">
        {series.map((r) => <span key={r.id}><i className="sw" style={{ background: `var(--${r.color})` }} />{r.name}</span>)}
        <span>пунктир: цель {period === "week" ? "на день" : "на неделю"}</span>
      </div>
      {tip && <div className="h-tip" style={{ left: Math.min(tip.x + 12, window.innerWidth - 260), top: tip.y - 36 }}>{tip.text}</div>}
    </>
  );
}

// 7. Проекты

function ProjectsBlock(props: { tasks: Task[]; projects: Project[]; onNew: () => void }) {
  const list = H.projectStats(props.tasks, props.projects);
  return (
    <>
      <Head title="Проекты"><button className="h-link" onClick={props.onNew}>+ Проект</button></Head>
      <div className="h-proj">
        {list.map(({ project: p, open, overdue, done }) => (
          <div key={p.id} className="h-pj">
            <b>{p.name}</b>
            <span className="mono h-pj-n">
              {open} откр.{overdue > 0 && <> · <span style={{ color: "var(--move)" }}>{overdue} просроч.</span></>}
            </span>
            <span className="pb"><i style={{ width: `${done + open ? (done / (done + open)) * 100 : 0}%`, background: `var(--${p.color})` }} /></span>
          </div>
        ))}
        {!list.length && <div className="h-note">Проектов пока нет.</div>}
      </div>
    </>
  );
}

// Настройка главной: галочка прячет блок, ⋮⋮ перетаскивает, ↑↓ для клавиатуры

function Customize(props: { order: BlockId[]; hidden: BlockId[]; onSave: (o: BlockId[], h: BlockId[]) => void; onClose: () => void }) {
  const [order, setOrder] = useState(props.order);
  const [hidden, setHidden] = useState(props.hidden);
  const [dragging, setDragging] = useState<BlockId | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const before = useRef(new Map<string, number>());

  useEffect(() => {
    const down = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!boxRef.current?.contains(el) && !el.closest(".h-cust-btn")) props.onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [props]);

  // Соседи плавно сдвигаются: запоминаем положение до перестановки и анимируем разницу
  const reorder = (next: BlockId[]) => {
    before.current = new Map([...(listRef.current?.children ?? [])].map((el) => [(el as HTMLElement).dataset.k!, el.getBoundingClientRect().top]));
    setOrder(next);
  };
  useLayoutEffect(() => {
    const prev = before.current;
    before.current = new Map();
    if (!prev.size || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const el of [...(listRef.current?.children ?? [])] as HTMLElement[]) {
      const top = prev.get(el.dataset.k!);
      if (top == null || el.dataset.k === dragging) continue;
      const d = top - el.getBoundingClientRect().top;
      if (d) el.animate([{ transform: `translateY(${d}px)` }, { transform: "none" }], { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
  }, [order]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = (k: BlockId, dir: -1 | 1) => {
    const i = order.indexOf(k), j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    reorder(next);
    props.onSave(next, hidden);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging || !listRef.current) return;
    const els = [...listRef.current.children] as HTMLElement[];
    const rest = els.filter((el) => el.dataset.k !== dragging);
    const after = rest.find((el) => {
      const r = el.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    const ids = rest.map((el) => el.dataset.k as BlockId);
    const at = after ? ids.indexOf(after.dataset.k as BlockId) : ids.length;
    const next = [...ids.slice(0, at), dragging, ...ids.slice(at)];
    if (next.join() !== orderRef.current.join()) reorder(next);
  };
  const endDrag = () => {
    if (!dragging) return;
    setDragging(null);
    props.onSave(orderRef.current, hidden);
  };

  return (
    <div className="h-cust" ref={boxRef}>
      <div className="h-cust-list" ref={listRef}>
        {order.map((k) => {
          const b = H.BLOCKS.find((x) => x.id === k)!;
          return (
            <div key={k} data-k={k} className={`it ${dragging === k ? "drag" : ""}`}>
              <span className="hd" title="Перетащи, чтобы поменять порядок"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDragging(k);
                }}
                onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>⋮⋮</span>
              <label>
                <input type="checkbox" checked={!hidden.includes(k)} onChange={(e) => {
                  const next = e.target.checked ? hidden.filter((h) => h !== k) : [...hidden, k];
                  setHidden(next);
                  props.onSave(order, next);
                }} />
                {b.name}
                {b.hint && <small>{b.hint}</small>}
              </label>
              <button className="mv" aria-label={`«${b.name}» выше`} onClick={() => move(k, -1)}>↑</button>
              <button className="mv" aria-label={`«${b.name}» ниже`} onClick={() => move(k, 1)}>↓</button>
            </div>
          );
        })}
      </div>
      <div className="hint">Тяни за ⋮⋮, чтобы выстроить блоки в своём порядке. Галочка прячет блок. Всё запоминается.</div>
      <button className="link" style={{ justifySelf: "start" }} onClick={() => {
        reorder(H.DEFAULT_ORDER);
        setHidden([]);
        props.onSave(H.DEFAULT_ORDER, []);
      }}>Вернуть как было</button>
    </div>
  );
}
