import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultBefore, minusMinutes, REMIND_OFF, remindAtFor, remindPatch, remindText, setBefore, setCustom } from "../remind";
import { digestBody, dueReminders, msOf, planDigest, planReminders, reminderText } from "../notifyPlan";
import { listFor } from "../views";
import { freezeToday, task } from "./helpers";

beforeEach(freezeToday); // сегодня 2026-10-10, 12:00
afterEach(() => vi.useRealTimers());

describe("напоминание относительно даты", () => {
  it("вычитает минуты через границы суток и месяца", () => {
    expect(minusMinutes("2026-10-12T14:00", 15)).toBe("2026-10-12T13:45");
    expect(minusMinutes("2026-10-12T00:10", 30)).toBe("2026-10-11T23:40");
    expect(minusMinutes("2026-11-01T09:00", 1440)).toBe("2026-10-31T09:00");
  });

  it("считает от начала задачи, а без времени от 9:00", () => {
    expect(remindAtFor("2026-10-12", "14:00", 60)).toBe("2026-10-12T13:00");
    expect(remindAtFor("2026-10-12", null, 5)).toBe("2026-10-12T08:55");
  });

  it("по умолчанию 15 минут, настройка меняет, мусор не принимается", () => {
    expect(defaultBefore({})).toBe(15);
    expect(defaultBefore({ "remind.before": "1440" })).toBe(1440);
    expect(defaultBefore({ "remind.before": "7" })).toBe(15);
  });

  it("включение ставит выбранный вариант, а задаче без даты сегодняшнюю дату", () => {
    expect(setBefore({ due_date: "2026-10-12", start_time: "14:00", remind_at: null, remind_before: null }, 15))
      .toEqual({ remind_before: 15, remind_at: "2026-10-12T13:45", reminded: 0 });
    expect(setBefore({ due_date: null, start_time: null, remind_at: null, remind_before: null }, 30))
      .toEqual({ due_date: "2026-10-10", remind_before: 30, remind_at: "2026-10-10T08:30", reminded: 0 });
    expect(REMIND_OFF).toEqual({ remind_at: null, remind_before: null, reminded: 0 });
  });

  it("своё время берёт посчитанный момент и меняет только время", () => {
    const x = { due_date: "2026-10-12", start_time: "14:00", remind_at: "2026-10-11T14:00", remind_before: 1440 };
    expect(setCustom(x)).toEqual({ remind_before: null, remind_at: "2026-10-11T14:00", reminded: 0 });
    expect(setCustom(x, "18:30").remind_at).toBe("2026-10-11T18:30");
  });

  it("при переносе задачи «за N минут» пересчитывается, своё время едет на те же дни", () => {
    const rel = task({ due_date: "2026-10-12", start_time: "14:00", remind_at: "2026-10-12T13:45", remind_before: 15 });
    expect(remindPatch(rel, { due_date: "2026-10-15" })).toEqual({ remind_at: "2026-10-15T13:45", reminded: 0 });
    expect(remindPatch(rel, { start_time: "10:00" }).remind_at).toBe("2026-10-12T09:45");
    expect(remindPatch(rel, { start_time: null }).remind_at).toBe("2026-10-12T08:45");
    const own = task({ due_date: "2026-10-12", remind_at: "2026-10-11T20:00", remind_before: null });
    expect(remindPatch(own, { due_date: "2026-10-14" }).remind_at).toBe("2026-10-13T20:00");
    expect(remindPatch(task(), { due_date: "2026-10-14" })).toEqual({});
  });

  it("подпись", () => {
    expect(remindText({ due_date: "2026-10-11", start_time: "10:00", remind_at: "2026-10-11T09:45", remind_before: 15 })).toBe("за 15 минут, Завтра 09:45");
    expect(remindText({ due_date: "2026-10-11", start_time: null, remind_at: "2026-10-10T20:00", remind_before: null })).toBe("Сегодня 20:00");
  });
});

describe("расписание уведомлений", () => {
  const now = new Date(2026, 9, 10, 12, 0).getTime();

  it("в расписание идут будущие несработавшие напоминания открытых задач", () => {
    const tasks = [
      task({ id: 1, remind_at: "2026-10-10T13:00" }),
      task({ id: 2, remind_at: "2026-10-10T11:00" }), // уже наступило
      task({ id: 3, remind_at: "2026-10-10T13:00", reminded: 1 }),
      task({ id: 4, remind_at: "2026-10-10T13:00", status: "done" }),
      task({ id: 5, remind_at: "2026-10-10T13:00", status: "inbox" }),
    ];
    const plan = planReminders(tasks, now);
    expect(plan.map((p) => p.key)).toEqual(["r:1:2026-10-10T13:00", "r:5:2026-10-10T13:00"]);
    expect(plan[0].at).toBe(msOf("2026-10-10T13:00"));
    expect(dueReminders(tasks, now).map((x) => x.id)).toEqual([2]);
  });

  it("встреча помечена в заголовке, «за 15 минут» превращается в «Через 15 минут»", () => {
    const x = task({ title: "Созвон с клиентом", kind: "meeting", start_time: "14:00", remind_before: 15, note: "Ссылка в календаре\nвторая строка" });
    expect(reminderText(x)).toEqual({ title: "Встреча: Созвон с клиентом", body: "Через 15 минут, в 14:00 · Ссылка в календаре" });
    expect(reminderText(task({ title: "Купить" })).body).toBe("Напоминание из Inbox");
  });

  it("сводка планируется, только если включена, впереди и есть что сказать", () => {
    const tasks = [task({ due_date: "2026-10-10" }), task({ status: "inbox" })];
    expect(digestBody(tasks)).toBe("На сегодня 1 задача, на разборе 1");
    const on = { "digest.enabled": "1", "digest.time": "18:00" };
    expect(planDigest(tasks, on, now)).toMatchObject({ key: "d:2026-10-10", title: "План на день" });
    expect(planDigest(tasks, { ...on, "digest.time": "09:00" }, now)).toBeNull();
    expect(planDigest(tasks, { ...on, "digest.last": "2026-10-10" }, now)).toBeNull();
    expect(planDigest([], on, now)).toBeNull();
    expect(planDigest(tasks, {}, now)).toBeNull();
  });
});

describe("сортировка по дате создания", () => {
  it("новые сверху, с группами по дню создания", () => {
    const tasks = [
      task({ id: 1, created_at: "2026-10-08T10:00:00" }),
      task({ id: 2, created_at: "2026-10-10T09:00:00" }),
      task({ id: 3, created_at: "2026-10-10T11:00:00" }),
    ];
    const list = listFor("soon", tasks, "created");
    expect(list.map((i) => i.task.id)).toEqual([3, 2, 1]);
    expect(list.map((i) => i.group)).toEqual(["Создано сегодня", undefined, "Создано чт, 8 окт"]);
  });
});
