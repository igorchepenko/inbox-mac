import { describe, expect, it } from "vitest";
import type { Person } from "../db";
import {
  ageOn, assignedCount, birthdayInYear, birthdayOn, birthdaysOn, birthdayTitle, fmtBirthday, formatBirthday, normalizeTelegram, parseBirthday, searchPeople, sortPeople, taskCount, waitingCount,
} from "../people";
import { task } from "./helpers";

let seq = 0;
const person = (p: Partial<Person> = {}): Person => ({
  id: ++seq, name: `Человек ${seq}`, phone: "", telegram: "", comment: "", birthday: null, company: "", job_title: "", tags: [], ...p,
});
const tag = (name: string) => ({ id: name.length, name, color: "teal" });

describe("день рождения", () => {
  it("разбирает дату с годом и без", () => {
    expect(parseBirthday("03-09")).toEqual({ month: 3, day: 9, year: null });
    expect(parseBirthday("1990-03-09")).toEqual({ month: 3, day: 9, year: 1990 });
    expect(parseBirthday("02-30")).toBeNull();
    expect(parseBirthday("13-01")).toBeNull();
    expect(parseBirthday("2001-02-29")).toBeNull();
    expect(parseBirthday("2000-02-29")?.year).toBe(2000);
    expect(parseBirthday(null)).toBeNull();
  });

  it("собирает строку для базы и отбрасывает несуществующие даты", () => {
    expect(formatBirthday(9, 3, null)).toBe("03-09");
    expect(formatBirthday(9, 3, 1990)).toBe("1990-03-09");
    expect(formatBirthday(31, 4, null)).toBeNull();
    expect(formatBirthday(null, 4, 1990)).toBeNull();
    expect(formatBirthday(29, 2, null)).toBe("02-29");
  });

  it("подписывает дату по-русски", () => {
    expect(fmtBirthday("03-09")).toBe("9 марта");
    expect(fmtBirthday("1990-10-01")).toBe("1 октября 1990");
    expect(fmtBirthday(null)).toBe("");
  });

  it("повторяется каждый год; год не обязателен", () => {
    const p = person({ birthday: "03-09" });
    expect(birthdayOn(p, "2026-03-09")).toBe(true);
    expect(birthdayOn(p, "2031-03-09")).toBe(true);
    expect(birthdayOn(p, "2026-03-10")).toBe(false);
    expect(birthdayOn(person(), "2026-03-09")).toBe(false);
  });

  it("29 февраля в невисокосный год попадает на 28-е", () => {
    const p = person({ birthday: "02-29" });
    expect(birthdayOn(p, "2028-02-29")).toBe(true);
    expect(birthdayOn(p, "2028-02-28")).toBe(false);
    expect(birthdayOn(p, "2027-02-28")).toBe(true);
    expect(birthdayOn(p, "2027-03-01")).toBe(false);
  });

  it("возраст только если известен год", () => {
    expect(ageOn(person({ birthday: "1990-03-09" }), "2026-03-09")).toBe(36);
    expect(ageOn(person({ birthday: "03-09" }), "2026-03-09")).toBeNull();
    expect(birthdayTitle(person({ name: "Аня", birthday: "1990-03-09" }), "2026-03-09")).toBe("День рождения: Аня, 36");
    expect(birthdayTitle(person({ name: "Аня", birthday: "03-09" }), "2026-03-09")).toBe("День рождения: Аня");
  });

  it("именинники дня по алфавиту", () => {
    const list = [person({ name: "Борис", birthday: "03-09" }), person({ name: "Аня", birthday: "03-09" }), person({ name: "Вера", birthday: "03-10" })];
    expect(birthdaysOn(list, "2026-03-09").map((p) => p.name)).toEqual(["Аня", "Борис"]);
  });
});

describe("сортировка людей", () => {
  const a = person({ name: "Андрей", company: "Ромашка", job_title: "Директор", birthday: "11-20", tags: [tag("клиент")] });
  const b = person({ name: "Борис", company: "Акме", birthday: "01-05", tags: [tag("друг")] });
  const c = person({ name: "Ёлкин" });
  const d = person({ name: "Вера", company: "Ромашка", job_title: "Аналитик", birthday: "03-01" });
  const names = (xs: Person[]) => xs.map((p) => p.name);

  it("по алфавиту, ё на месте", () => {
    expect(names(sortPeople([c, d, b, a], "name"))).toEqual(["Андрей", "Борис", "Вера", "Ёлкин"]);
    expect(names(sortPeople([c, d, b, a], "name", true))).toEqual(["Ёлкин", "Вера", "Борис", "Андрей"]);
  });

  it("по дню рождения от 1 января, без даты в конце", () => {
    expect(names(sortPeople([a, b, c, d], "birthday"))).toEqual(["Борис", "Вера", "Андрей", "Ёлкин"]);
    expect(names(sortPeople([a, b, c, d], "birthday", true))).toEqual(["Андрей", "Вера", "Борис", "Ёлкин"]);
  });

  it("по тегу, компании и должности пустые в конце", () => {
    expect(names(sortPeople([a, b, c, d], "tag"))).toEqual(["Борис", "Андрей", "Вера", "Ёлкин"]);
    expect(names(sortPeople([a, b, c, d], "company"))).toEqual(["Борис", "Андрей", "Вера", "Ёлкин"]);
    expect(names(sortPeople([a, b, c, d], "job"))).toEqual(["Вера", "Андрей", "Борис", "Ёлкин"]);
  });

  it("не меняет исходный массив", () => {
    const src = [b, a];
    sortPeople(src, "name");
    expect(names(src)).toEqual(["Борис", "Андрей"]);
  });
});

describe("поиск людей", () => {
  const a = person({ name: "Андрей Ёлкин", company: "Ромашка", job_title: "Директор", phone: "+7 (915) 123-45-67", telegram: "elkin_a", tags: [tag("клиент")] });
  const b = person({ name: "Борис", company: "Акме", job_title: "Аналитик", tags: [tag("друг")] });
  const all = [a, b];
  const found = (q: string) => searchPeople(q, all).map((p) => p.name);

  it("по имени без регистра и ё/е", () => {
    expect(found("елкин")).toEqual(["Андрей Ёлкин"]);
    expect(searchPeople("", all)).toBe(all);
  });

  it("по тегу, компании и должности", () => {
    expect(found("клиент")).toEqual(["Андрей Ёлкин"]);
    expect(found("акме")).toEqual(["Борис"]);
    expect(found("аналит")).toEqual(["Борис"]);
  });

  it("по телефону цифрами и по нику Telegram с @ и без", () => {
    expect(found("915 12")).toEqual(["Андрей Ёлкин"]);
    expect(found("+7915")).toEqual(["Андрей Ёлкин"]);
    expect(found("@elkin")).toEqual(["Андрей Ёлкин"]);
    expect(found("elkin_a")).toEqual(["Андрей Ёлкин"]);
    expect(found("777")).toEqual([]);
  });
});

describe("прочее", () => {
  it("считает задачи, где человек назначил или участвовал", () => {
    const tasks = [
      task({ assigned_by: "андрей" }),
      task({ participants: ["Андрей", "Борис"] }),
      task({ assigned_by: "Борис", participants: ["Андрей"] }),
      task({}),
    ];
    expect(taskCount("Андрей", tasks)).toBe(3);
    expect(taskCount("Борис", tasks)).toBe(2);
    expect(taskCount("Вера", tasks)).toBe(0);
  });

  it("ник Telegram без @ и из ссылки", () => {
    expect(normalizeTelegram(" @elkin ")).toBe("elkin");
    expect(normalizeTelegram("https://t.me/elkin?start=1")).toBe("elkin");
    expect(normalizeTelegram("t.me/elkin")).toBe("elkin");
    expect(normalizeTelegram("")).toBe("");
  });
});

describe("переходы из списка людей", () => {
  it("день рождения в нужном году, 29 февраля в невисокосный — 28-е", () => {
    expect(birthdayInYear("03-09", 2026)).toBe("2026-03-09");
    expect(birthdayInYear("1990-03-09", 2026)).toBe("2026-03-09");
    expect(birthdayInYear("02-29", 2026)).toBe("2026-02-28");
    expect(birthdayInYear("02-29", 2028)).toBe("2028-02-29");
    expect(birthdayInYear(null, 2026)).toBeNull();
  });

  it("счётчики: назначил и жду считают только открытые задачи", () => {
    const xs = [
      task({ id: 1, assigned_by: "Андрей" }),
      task({ id: 2, assigned_by: "андрей", status: "done" }),
      task({ id: 3, waiting_for: "Андрей" }),
      task({ id: 4, waiting_for: "Андрей", status: "archived" }),
    ];
    expect(assignedCount("Андрей", xs)).toBe(1);
    expect(waitingCount("Андрей", xs)).toBe(1);
  });
});
