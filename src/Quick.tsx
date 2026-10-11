import { useEffect, useRef, useState } from "react";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { addTask, loadPeople, loadProjects, loadTags, type Draft, type Project, type Tag } from "./db";
import { QuickForm } from "./components";
import { currentZoom } from "./prefs";
import { activeProfile, profileName } from "./profile";

const hideQuick = () => invoke("hide_quick");

/** Окно ⌥Space: маленькая карточка поверх всех приложений */
export default function QuickApp() {
  // Новый ключ пересоздаёт форму с пустыми полями. Делаем это до того, как окно спрячется,
  // а не при открытии: иначе первые буквы, набранные сразу после ⌥Space, потеряются
  const [key, setKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  // Пространства, теги и люди для подсказок: перечитываем при каждом открытии, их могли поменять в главном окне
  const refreshProjects = () => {
    loadProjects().then(setProjects).catch(() => {});
    loadTags().then(setTags).catch(() => {});
    loadPeople().then(setPeople).catch(() => {});
  };
  const win = getCurrentWindow();
  const root = useRef<HTMLDivElement>(null);

  // Окно подстраивает высоту под карточку: длинная заметка растягивает его вниз.
  // Пока окно спрятано, браузер может не сообщать об изменениях, поэтому меряем ещё и при открытии
  const fit = () => {
    if (!root.current) return;
    // Размер текста в настройках масштабирует окно: высота карточки в пикселях окна больше на этот множитель
    const h = Math.ceil(root.current.getBoundingClientRect().height * currentZoom());
    win.setSize(new LogicalSize(580, h)).catch(() => {});
  };
  useEffect(() => {
    if (!root.current) return;
    const ro = new ResizeObserver(fit);
    ro.observe(root.current);
    addEventListener("inbox-appearance", fit);
    return () => (ro.disconnect(), removeEventListener("inbox-appearance", fit));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    refreshProjects(); // заодно заранее открыть базу, чтобы первое сохранение было мгновенным
    const focusTitle = () => document.querySelector<HTMLInputElement>(".qi-title")?.focus();
    const un = [
      listen("quick-open", () => (fit(), focusTitle(), refreshProjects())),
      win.onFocusChanged(({ payload }) => payload && focusTitle()),
    ];
    return () => un.forEach((p) => p.then((f) => f()));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (title: string, note: string, draft: Draft) => {
    try {
      await addTask(title, note, draft);
      setError(null);
      setKey((k) => k + 1);
      await hideQuick();
      await emit("tasks-changed");
    } catch (e) {
      setError(String(e));
    }
  };

  // Esc стирает черновик. Если просто кликнуть мимо, окно спрячется, а набранное останется
  const cancel = () => {
    setKey((k) => k + 1);
    hideQuick();
  };

  return (
    <div ref={root} className="quick-root">
      <QuickForm key={key} projects={projects} tags={tags} people={people} onSave={save} onCancel={cancel} profile={profileName(activeProfile())} />
      {error && <div className="error">Не сохранилось: {error}</div>}
    </div>
  );
}
