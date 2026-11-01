import { useSyncExternalStore } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";

/*
 * Профили: у каждого своя база, свои вложения и свои настройки, связи между ними нет.
 * Список (id и название) хранит Rust в profiles.json, здесь его копия: тема и внешний вид читают её
 * синхронно до первой отрисовки. Выбор активного живёт в localStorage, общем для обоих окон.
 * «test» (прежний «Тест») хранит настройки под прежними ключами, поэтому они не потерялись.
 */

export type ProfileId = string;
export interface ProfileInfo {
  id: ProfileId;
  name: string;
}

const KEY = "inbox.profile";
const LIST_KEY = "inbox.profile-list";

function readList(): ProfileInfo[] {
  try {
    const v = JSON.parse(localStorage.getItem(LIST_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((p) => p && typeof p.id === "string" && typeof p.name === "string") : [];
  } catch {
    return [];
  }
}

let list: ProfileInfo[] = readList();
const subs = new Set<() => void>();

function setList(next: ProfileInfo[]) {
  if (JSON.stringify(next) === JSON.stringify(list)) return;
  list = next;
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(next));
  } catch {
    // без localStorage список живёт только в памяти окна
  }
  subs.forEach((f) => f());
}

export const profiles = () => list;

/** Список профилей в компонентах: перерисовывается, когда профиль создан, переименован или удалён */
export function useProfiles(): ProfileInfo[] {
  return useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), profiles);
}

/** Перечитать список у Rust. Вызывается при запуске окна и по событию profiles-changed */
export async function loadProfiles(): Promise<ProfileInfo[]> {
  try {
    setList(await invoke<ProfileInfo[]>("list_profiles"));
  } catch {
    // Rust недоступен (тесты, браузер): остаётся копия из localStorage
  }
  return list;
}

export const isProfile = (v: unknown): v is ProfileId => typeof v === "string" && list.some((p) => p.id === v);

/** Активный профиль. Нет сохранённого выбора или он удалён: первый в списке. Список пуст: "" */
export function activeProfile(): ProfileId {
  try {
    const v = localStorage.getItem(KEY);
    if (isProfile(v)) return v;
  } catch {
    // ниже вернём первый
  }
  return list[0]?.id ?? "";
}

export const profileName = (id: ProfileId) => list.find((p) => p.id === id)?.name ?? id;

/** Ключ localStorage в профиле. У «test» ключи прежние, у остальных с префиксом id */
export function profileKey(key: string, p: ProfileId = activeProfile()): string {
  return p === "test" ? key : `${p || "none"}:${key}`;
}

/** Сменить профиль: запомнить и перезагрузить оба окна, они откроют базу нового профиля */
export async function switchProfile(p: ProfileId) {
  if (p === activeProfile()) return;
  try {
    localStorage.setItem(KEY, p);
  } catch {
    return; // без localStorage выбор не сохранить, остаёмся где были
  }
  await emit("profile-changed", p).catch(() => {});
  location.reload();
}

/** Создать профиль и сразу перейти в него. Возвращает текст ошибки */
export async function createProfile(name: string): Promise<string | null> {
  try {
    const e = await invoke<ProfileInfo>("create_profile", { name });
    await loadProfiles();
    try {
      localStorage.setItem(KEY, e.id);
    } catch {
      // без localStorage откроется первый в списке
    }
    await emit("profile-changed", e.id).catch(() => {});
    location.reload();
    return null;
  } catch (e) {
    return String(e);
  }
}

export async function renameProfile(id: ProfileId, name: string): Promise<string | null> {
  try {
    await invoke("rename_profile", { id, name });
    await loadProfiles();
    return null;
  } catch (e) {
    return String(e);
  }
}

/** Поставить профили в новом порядке: он же в меню внизу слева и в строке меню */
export async function reorderProfiles(ids: ProfileId[]): Promise<string | null> {
  try {
    await invoke("reorder_profiles", { ids });
    await loadProfiles();
    return null;
  } catch (e) {
    return String(e);
  }
}

/**
 * Удалить профиль. Сначала закрываем его базу в движке: иначе он держал бы файл открытым и,
 * когда запасной файл достанется новому профилю, отдал бы ему старое соединение.
 * Настройки профиля стираем из localStorage, чтобы новый профиль на том же файле начал с чистого листа
 */
export async function deleteProfile(id: ProfileId): Promise<string | null> {
  try {
    const url = await invoke<string>("profile_url", { id });
    const d = await Database.load(url);
    await d.close();
    await invoke("delete_profile", { id });
    if (id !== "test") {
      try {
        Object.keys(localStorage).filter((k) => k.startsWith(`${id}:`)).forEach((k) => localStorage.removeItem(k));
      } catch {
        // не страшно: настройки чужого профиля просто останутся лежать
      }
    }
    const was = activeProfile() === id;
    await loadProfiles();
    if (was) {
      try {
        localStorage.removeItem(KEY);
      } catch {
        // выбор и так упадёт на первый в списке
      }
      await emit("profile-changed", "").catch(() => {});
      location.reload();
    }
    return null;
  } catch (e) {
    return String(e);
  }
}

/**
 * Второе окно перезагружается следом. Главное ещё слушает выбор профиля в меню строки меню:
 * Rust не знает, где хранится выбор, и просит окно переключиться
 */
export function followProfileChanges(isMain: boolean) {
  document.documentElement.dataset.profile = activeProfile();
  listen<ProfileId>("profile-changed", (e) => e.payload !== activeProfile() || location.reload()).catch(() => {});
  listen("profiles-changed", () => void loadProfiles()).catch(() => {});
  if (isMain) listen<string>("profile-pick", (e) => isProfile(e.payload) && switchProfile(e.payload)).catch(() => {});
}
