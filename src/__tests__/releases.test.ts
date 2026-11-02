import { describe, expect, it } from "vitest";
import pkg from "../../package.json";
import { CHANGE_WORDS, fmtReleaseDate, markReleasesSeen, MAX_ITEM, RELEASES, SEEN_KEY, shouldShowReleases } from "../releases";

const firstWord = (s: string) => s.split(/[\s:,.]/, 1)[0].toLowerCase();
const semver = (v: string) => v.split(".").map(Number);

describe("история версий: правила пунктов", () => {
  it("каждый пункт начинается со слова-изменения", () => {
    const bad = RELEASES.flatMap((r) => r.items.filter((i) => !CHANGE_WORDS.includes(firstWord(i))).map((i) => `${r.version}: ${i}`));
    expect(bad).toEqual([]);
  });

  it(`пункт не длиннее ${MAX_ITEM} символов с пробелами и знаками`, () => {
    const bad = RELEASES.flatMap((r) => r.items.filter((i) => i.length > MAX_ITEM).map((i) => `${r.version} (${i.length}): ${i}`));
    expect(bad).toEqual([]);
  });

  it("пункты не пустые и без повторов внутри релиза", () => {
    for (const r of RELEASES) {
      expect(r.items.length, r.version).toBeGreaterThan(0);
      expect(new Set(r.items).size, r.version).toBe(r.items.length);
      for (const i of r.items) expect(i.trim(), r.version).toBe(i);
    }
  });
});

describe("история версий: порядок релизов", () => {
  it("версии строго убывают, даты не растут от новых к старым", () => {
    for (let k = 1; k < RELEASES.length; k++) {
      const a = semver(RELEASES[k - 1].version);
      const b = semver(RELEASES[k].version);
      const newer = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
      expect(newer, `${RELEASES[k - 1].version} после ${RELEASES[k].version}`).toBeGreaterThan(0);
      expect(RELEASES[k - 1].date >= RELEASES[k].date, `${RELEASES[k - 1].version} старше по дате, чем ${RELEASES[k].version}`).toBe(true);
    }
  });

  it("даты записаны как ГГГГ-ММ-ДД, версии как X.Y.Z", () => {
    for (const r of RELEASES) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("первый релиз истории совпадает с версией приложения, последний это 0.1.0", () => {
    expect(RELEASES[0].version).toBe(pkg.version);
    expect(RELEASES[RELEASES.length - 1].version).toBe("0.1.0");
  });

  it("дата в заголовке: ДД.ММ.ГГГГ", () => {
    expect(fmtReleaseDate("2026-10-26")).toBe("26.10.2026");
    expect(fmtReleaseDate("мусор")).toBe("мусор");
  });
});

describe("окно новинок при первом запуске", () => {
  it("новая версия, которую ещё не показывали, открывает окно", () => {
    expect(shouldShowReleases("", "0.21.0")).toBe(true);
    expect(shouldShowReleases("0.20.0", "0.21.0")).toBe(true);
  });
  it("показанную версию повторно не открывает: ни после перезапуска, ни после смены профиля", () => {
    expect(shouldShowReleases("0.21.0", "0.21.0")).toBe(false);
  });
  it("без доступного хранилища окно не открывается, чтобы не вылезать на каждом запуске", () => {
    expect(shouldShowReleases(null, "0.21.0")).toBe(false);
  });
  it("запоминание пишет версию в общий ключ, без префикса профиля", () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { setItem: (k: string, v: string) => store.set(k, v), getItem: (k: string) => store.get(k) ?? null };
    expect(markReleasesSeen("0.21.0")).toBe(true);
    expect(store.get(SEEN_KEY)).toBe("0.21.0");
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(markReleasesSeen("0.22.0")).toBe(false);
  });
});
