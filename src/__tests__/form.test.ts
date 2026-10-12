import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fmtRange, fmtStamp, typeTimeDigit } from "../dates";
import { dueState, hasDue } from "../due";
import { anchorOf, remindAtFor, remindPatch, setBefore, setCustom } from "../remind";
import { reminderText } from "../notifyPlan";
import { freezeToday, task } from "./helpers";

beforeEach(freezeToday); // сегодня 2026-10-10, 12:00
afterEach(() => vi.useRealTimers());

describe("ввод времени по цифре", () => {
  it("в выделенных часах цифра начинает значение заново", () => {
    expect(typeTimeDigit("12", true, 4, 23)).toEqual({ value: "04", done: true });
    expect(typeTimeDigit("12", true, 1, 23)).toEqual({ value: "1", done: false });
    expect(typeTimeDigit("1", false, 4, 23)).toEqual({ value: "14", done: true });
    expect(typeTimeDigit("2", false, 3, 23)).toEqual({ value: "23", done: true });
  });
  it("часы за пределом 23 начинаются со второй цифры", () => {
    expect(typeTimeDigit("2", false, 5, 23)).toEqual({ value: "05", done: true });
  });
  it("минуты в пределах 59", () => {
    expect(typeTimeDigit("45", true, 7, 59)).toEqual({ value: "07", done: true });
    expect(typeTimeDigit("45", true, 5, 59)).toEqual({ value: "5", done: false });
    expect(typeTimeDigit("5", false, 9, 59)).toEqual({ value: "59", done: true });
  });
  it("в заполненном поле без выделения тоже начинает заново", () => {
    expect(typeTimeDigit("14", false, 3, 23)).toEqual({ value: "03", done: true });
  });
});

describe("форматы", () => {
  it("дата создания полностью", () => {
    expect(fmtStamp("2026-10-16T14:30:12")).toBe("16.10.2026 14:30");
  });
  it("только конец — срок", () => {
    expect(fmtRange(null, "18:00")).toBe("до 18:00");
    expect(fmtRange("10:00", "11:00")).toBe("10:00–11:00");
  });
});

describe("срок: только время окончания", () => {
  it("есть только у задачи с днём и концом без начала", () => {
    expect(hasDue(task({ due_date: "2026-10-10", end_time: "18:00" }))).toBe(true);
    expect(hasDue(task({ due_date: "2026-10-10", start_time: "10:00", end_time: "18:00" }))).toBe(false);
    expect(hasDue(task({ due_date: null, end_time: "18:00" }))).toBe(false);
  });
  it("подсвечивается как прежний дедлайн", () => {
    expect(dueState(task({ status: "active", due_date: "2026-10-10", end_time: "11:00" }))).toBe("overdue");
    expect(dueState(task({ status: "active", due_date: "2026-10-10", end_time: "18:00" }))).toBe("soon");
    expect(dueState(task({ status: "active", due_date: "2026-10-11", end_time: "18:00" }))).toBe("soon");
    expect(dueState(task({ status: "active", due_date: "2026-10-14", end_time: "18:00" }))).toBe(null);
    expect(dueState(task({ status: "done", due_date: "2026-10-09", end_time: "18:00" }))).toBe(null);
  });
  it("напоминание «за 15 минут» считается от срока", () => {
    expect(anchorOf({ start_time: null, end_time: "18:00" })).toBe("18:00");
    expect(setBefore({ due_date: "2026-10-12", start_time: null, end_time: "18:00", remind_at: null, remind_before: null }, 15).remind_at)
      .toBe("2026-10-12T17:45");
    const x = { due_date: "2026-10-12", start_time: null, end_time: "18:00", remind_at: remindAtFor("2026-10-12", "18:00", 60), remind_before: 60 };
    expect(remindPatch(x, { end_time: "20:00" }).remind_at).toBe("2026-10-12T19:00");
    expect(reminderText(task({ title: "Отчёт", end_time: "18:00", remind_before: 60, remind_at: "2026-10-10T17:00" })).body).toBe("Срок через 1 час, до 18:00");
  });
});

describe("свой день напоминания", () => {
  it("день меняется отдельно от времени", () => {
    const x = { due_date: "2026-10-12", start_time: "14:00", remind_at: "2026-10-12T13:45", remind_before: null };
    expect(setCustom(x, undefined, "2026-10-11").remind_at).toBe("2026-10-11T13:45");
    expect(setCustom(x, "09:30").remind_at).toBe("2026-10-12T09:30");
  });
});
