import { emit, listen } from "@tauri-apps/api/event";

/*
 * Профили: у каждого своя база, свои вложения и свои настройки. «Тест» для проверки новых сборок,
 * «Игорь» для настоящих задач. Всё, что было до профилей, осталось в «Тесте».
 * Выбор живёт в localStorage, общем для обоих окон: тема и внешний вид читают его до первой отрисовки.
 */

export type ProfileId = "test" | "igor";

export const PROFILES: { id: ProfileId; name: string; hint: string }[] = [
  { id: "test", name: "Тест", hint: "Для проверки новых сборок. Здесь всё, что было до профилей" },
  { id: "igor", name: "Игорь", hint: "Настоящие задачи, без экспериментов" },
];

const KEY = "inbox.profile";

export const isProfile = (v: unknown): v is ProfileId => PROFILES.some((p) => p.id === v);

export function activeProfile(): ProfileId {
  try {
    const v = localStorage.getItem(KEY);
    return isProfile(v) ? v : "test";
  } catch {
    return "test";
  }
}

export const profileName = (id: ProfileId) => PROFILES.find((p) => p.id === id)?.name ?? id;

/** Ключ localStorage в профиле. У «Теста» ключи прежние, поэтому его тема, шрифт и ширина панелей не потерялись */
export function profileKey(key: string, p: ProfileId = activeProfile()): string {
  return p === "test" ? key : `${p}:${key}`;
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

/**
 * Второе окно перезагружается следом. Главное ещё слушает выбор профиля в меню строки меню:
 * Rust не знает, где хранится выбор, и просит окно переключиться
 */
export function followProfileChanges(isMain: boolean) {
  document.documentElement.dataset.profile = activeProfile();
  listen<ProfileId>("profile-changed", (e) => e.payload !== activeProfile() || location.reload()).catch(() => {});
  if (isMain) listen<string>("profile-pick", (e) => isProfile(e.payload) && switchProfile(e.payload)).catch(() => {});
}
