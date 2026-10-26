import { describe, expect, it } from "vitest";
import { blockingCount, candidates, isBlocked, openBlockers, relationsByTask, rowFor, wouldCycle, type RelationRow } from "../relations";
import { task } from "./helpers";

const A = task({ id: 101, title: "Согласовать бюджет" });
const B = task({ id: 102, title: "Заказать оборудование" });
const C = task({ id: 103, title: "Презентация" });
const rows: RelationRow[] = [{ id: 1, from_id: 101, to_id: 102, kind: "blocks" }, { id: 2, from_id: 103, to_id: 101, kind: "related" }];
const withRels = (ts = [A, B, C], rs = rows) => {
  const m = relationsByTask(rs, ts);
  return ts.map((t) => ({ ...t, relations: m.get(t.id) ?? [] }));
};

describe("связи задач", () => {
  it("«блокирует» у одной задачи даёт «заблокирована» у другой", () => {
    const [a, b] = withRels();
    expect(a.relations.find((r) => r.other_id === 102)?.kind).toBe("blocks");
    expect(b.relations[0]).toMatchObject({ kind: "blocked", other_id: 101, other_title: "Согласовать бюджет" });
    expect(isBlocked(b)).toBe(true);
    expect(blockingCount(a)).toBe(1);
  });

  it("«связана» читается в обе стороны и не блокирует", () => {
    const [a, , c] = withRels();
    expect(c.relations[0]).toMatchObject({ kind: "related", other_id: 101 });
    expect(a.relations.find((r) => r.other_id === 103)?.kind).toBe("related");
    expect(isBlocked(c)).toBe(false);
  });

  it("закрытая блокирующая (сделана или отменена) снимает блокировку", () => {
    for (const status of ["done", "archived"] as const) {
      const [, b] = withRels([{ ...A, status }, B, C]);
      expect(openBlockers(b)).toHaveLength(0);
      expect(isBlocked(b)).toBe(false);
    }
  });

  it("закрытая задача заблокированной не считается", () => {
    const [, b] = withRels();
    expect(isBlocked({ ...b, status: "done" })).toBe(false);
  });

  it("строки на удалённые задачи пропускаются", () => {
    const [a] = withRels([A, C]);
    expect(a.relations.map((r) => r.other_id)).toEqual([103]);
  });

  it("цикл находится, в том числе через цепочку", () => {
    const chain = [{ from_id: 1, to_id: 2, kind: "blocks" as const }, { from_id: 2, to_id: 3, kind: "blocks" as const }];
    expect(wouldCycle(chain, 3, 1)).toBe(true);
    expect(wouldCycle(chain, 1, 3)).toBe(false);
    expect(wouldCycle(chain, 1, 1)).toBe(true);
    expect(wouldCycle([{ from_id: 2, to_id: 1, kind: "related" }], 1, 2)).toBe(false);
  });

  it("«заблокирована» записывается как «блокирует» с другой стороны", () => {
    expect(rowFor(5, 9, "blocked")).toEqual({ from_id: 9, to_id: 5, kind: "blocks" });
    expect(rowFor(5, 9, "blocks")).toEqual({ from_id: 5, to_id: 9, kind: "blocks" });
    expect(rowFor(5, 9, "related")).toEqual({ from_id: 5, to_id: 9, kind: "related" });
  });

  it("поиск: по названию, без себя, без уже связанных и без архива", () => {
    const all = withRels([A, B, C, task({ id: 104, title: "Бюджет архив", status: "archived" }), task({ id: 105, title: "Бюджет на отпуск" })]);
    const found = candidates(all, all[0], "бюджет");
    expect(found.map((t) => t.id)).toEqual([105]);
    expect(candidates(all, all[2], "").map((t) => t.id)).not.toContain(101);
  });
});
