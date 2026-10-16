import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Building2, Cake, MessageCircle, Phone, StickyNote, UserRound } from "lucide-react";
import type { Person } from "./db";
import { fmtBirthday } from "./people";
import { sameName } from "./tags";
import { TagChip } from "./TagsUI";

/** Люди из раздела «Люди»: по ним строится карточка при наведении на имя в задаче */
export const PeopleCtx = createContext<Person[]>([]);

export const findPerson = (people: Person[], name: string) => people.find((p) => sameName(p.name, name));

/** Есть ли что показать в карточке кроме имени */
export const hasDetails = (p: Person) =>
  !!(p.phone || p.telegram || p.comment || p.birthday || p.company || p.job_title || p.tags.length);

/** Содержимое карточки человека: контакты, работа, теги, день рождения, комментарий */
export function PersonSummary({ person: p }: { person: Person }) {
  const work = [p.job_title, p.company].filter(Boolean).join(", ");
  return (
    <div className="pc-body">
      <div className="pc-name"><UserRound size={13} /> <b>{p.name}</b></div>
      {work && <div className="pc-row"><Building2 size={12} /> {work}</div>}
      {p.tags.length > 0 && <div className="pc-tags">{p.tags.map((t) => <TagChip key={t.id} name={t.name} color={t.color} />)}</div>}
      {p.phone && <div className="pc-row"><Phone size={12} /> {p.phone}</div>}
      {p.telegram && <div className="pc-row"><MessageCircle size={12} /> @{p.telegram}</div>}
      {p.birthday && <div className="pc-row"><Cake size={12} /> {fmtBirthday(p.birthday)}</div>}
      {p.comment && <div className="pc-row pc-note"><StickyNote size={12} /> <span>{p.comment}</span></div>}
    </div>
  );
}

/** Карточка всплывает под элементом (или над ним, если внизу нет места) через 0,3 с после наведения */
export function HoverCard(props: { card: ReactNode; children: ReactNode; className?: string }) {
  const host = useRef<HTMLSpanElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const enter = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), open ? 0 : 300);
  };
  const leave = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), 120);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!open || !host.current || !card.current) return setPos(null);
    const a = host.current.getBoundingClientRect();
    const c = card.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(a.left, window.innerWidth - c.width - 8));
    const top = a.bottom + 6 + c.height > window.innerHeight - 8 ? Math.max(8, a.top - c.height - 6) : a.bottom + 6;
    setPos({ left, top });
  }, [open]);
  return (
    <span ref={host} className={props.className} onMouseEnter={enter} onMouseLeave={leave}>
      {props.children}
      {open && createPortal(
        <div ref={card} className="person-card" style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: "hidden" }}
          onMouseEnter={enter} onMouseLeave={leave}>{props.card}</div>,
        document.body,
      )}
    </span>
  );
}

/** Кто назначил: маленькая подпись с иконкой человека. Если про человека есть данные, при наведении показывается его карточка */
export function Assignee({ name }: { name: string }) {
  const person = findPerson(useContext(PeopleCtx), name);
  const label = (
    <span className="meta who" title={person && hasDetails(person) ? undefined : `Назначил: ${name}`}>
      <UserRound size={11} /><span className="who-n">{name}</span>
    </span>
  );
  if (!person || !hasDetails(person)) return label;
  return <HoverCard card={<PersonSummary person={person} />} className="who-host">{label}</HoverCard>;
}
