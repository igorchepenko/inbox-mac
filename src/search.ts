import type { Project, Task } from "./db";
import { compareBy, type ListItem } from "./views";
import { today } from "./dates";

/** Без регистра и без разницы между «е» и «ё» */
export const fold = (s: string) => s.toLocaleLowerCase("ru").replace(/ё/g, "е");

/** Слова запроса: каждое должно найтись в задаче, порядок любой */
export const words = (q: string) => fold(q).split(/\s+/).filter(Boolean);

/** Где искать: название, заметка, пункты чеклиста, теги, кто назначил, пространство, подписи ссылок */
function haystack(x: Task, space?: Project): string {
  return fold([
    x.title, x.note, ...x.subtasks.map((s) => s.title), ...x.tags.map((t) => t.name), x.assigned_by ?? "", ...x.participants,
    space?.name ?? "", ...x.links.map((l) => `${l.title} ${l.url}`),
  ].join("\n"));
}

/** Где задача живёт сейчас: так же, как разложены списки в меню */
function placeOf(x: Task, t: string): { rank: number; name: string } {
  if (x.status === "inbox") return { rank: 0, name: "Новые" };
  if (x.status === "active") return x.due_date && x.due_date <= t ? { rank: 1, name: "Сегодня" } : { rank: 2, name: "Скоро" };
  if (x.status === "done") return { rank: 3, name: "Сделано" };
  return { rank: 4, name: "Архив" };
}

/** Поиск по всем задачам, включая сделанные и архив. Группы по месту, внутри сначала совпадения в названии, затем по дате */
export function searchTasks(query: string, tasks: Task[], projects: Project[]): ListItem[] {
  const ws = words(query);
  if (!ws.length) return [];
  const t = today();
  const byDate = compareBy("date");
  const found = tasks
    .map((x) => ({ x, hay: haystack(x, projects.find((p) => p.id === x.project_id)), title: fold(x.title), place: placeOf(x, t) }))
    .filter((f) => ws.every((w) => f.hay.includes(w)))
    .map((f) => ({ ...f, inTitle: ws.every((w) => f.title.includes(w)) }));
  found.sort((a, b) =>
    a.place.rank - b.place.rank || Number(b.inTitle) - Number(a.inTitle)
    // Архив и сделанные: свежие сверху
    || (a.place.rank >= 3 ? ((a.x.done_at ?? "") < (b.x.done_at ?? "") ? 1 : -1) : byDate(a.x, b.x)));
  let last = "";
  return found.map(({ x, place }) => {
    const item = place.name !== last ? { task: x, group: place.name } : { task: x };
    last = place.name;
    return item;
  });
}

/** Куски текста для подсветки найденного: [обычный, найденный, обычный, ...] */
export function marks(text: string, query: string): string[] {
  const ws = words(query);
  if (!ws.length) return [text];
  const low = fold(text);
  if (low.length !== text.length) return [text]; // редкие буквы меняют длину при смене регистра, тогда без подсветки
  const hit = new Array<boolean>(text.length).fill(false);
  for (const w of ws) for (let i = low.indexOf(w); i >= 0; i = low.indexOf(w, i + 1)) hit.fill(true, i, i + w.length);
  const out: string[] = [];
  let cur = "", on = false;
  for (let i = 0; i < text.length; i++) {
    if (hit[i] !== on) {
      out.push(cur);
      cur = "";
      on = hit[i];
    }
    cur += text[i];
  }
  out.push(cur);
  return out;
}
