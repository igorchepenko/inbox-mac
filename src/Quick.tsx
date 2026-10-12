import { useEffect, useRef, useState } from "react";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { addProject, addTask, loadPeople, loadProjects, loadSettings, loadTags, loadTasks, type Draft, type Project, type Tag } from "./db";
import { syncPlan } from "./reminders";
import { defaultBefore } from "./remind";
import { QuickForm } from "./components";
import { currentZoom } from "./prefs";
import { activeProfile, profileName } from "./profile";
import { nextSpaceColor } from "./palette";

const hideQuick = () => invoke("hide_quick");

/** Окно ⌥Space: маленькая карточка поверх всех приложений */
export default function QuickApp() {
  // Новый ключ пересоздаёт форму пустой и свёрнутой. Делаем это, когда окно прячется (quick-reset из lib.rs),
  // а не при открытии: иначе первые буквы, набранные сразу после ⌥Space, потеряются
  const [key, setKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const [remindBefore, setRemindBefore] = useState(15);
  // Пространства, теги, люди и напоминание по умолчанию: перечитываем при каждом открытии, их могли поменять в главном окне
  const refreshProjects = () => {
    loadProjects().then(setProjects).catch(() => {});
    loadTags().then(setTags).catch(() => {});
    loadPeople().then(setPeople).catch(() => {});
    loadSettings().then((st) => setRemindBefore(defaultBefore(st))).catch(() => {});
  };
  const win = getCurrentWindow();
  const root = useRef<HTMLDivElement>(null);

  // Окно подстраивает высоту под карточку: длинная заметка растягивает его вниз.
  // Пока окно спрятано, браузер может не сообщать об изменениях, поэтому меряем ещё и при открытии
  const fit = () => {
    if (!root.current) return;
    // Верх карточки стоит на двадцатой части экрана, как у окна по N (lib.rs, place_quick) и растёт вниз не дальше Dock: дальше прокручиваются параметры
    const zoom = currentZoom();
    root.current.style.setProperty("--qmax", `${Math.floor((screen.availHeight * 19) / 20 - 14) / zoom}px`);
    // Размер текста в настройках масштабирует окно: высота карточки в пикселях окна больше на этот множитель
    const h = Math.ceil(root.current.getBoundingClientRect().height * zoom);
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
      // Окно спряталось (Esc, клик мимо, повторное сочетание): черновик не переносим в следующий раз
      listen("quick-reset", () => setKey((k) => k + 1)),
      win.onFocusChanged(({ payload }) => payload && focusTitle()),
    ];
    return () => un.forEach((p) => p.then((f) => f()));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (title: string, note: string, draft: Draft) => {
    try {
      await addTask(title, note, draft);
      setError(null);
      // Напоминание сразу в расписание macOS: главное окно может быть спрятано и прочитает базу не скоро
      if (draft.remind_at) Promise.all([loadTasks(), loadSettings()]).then(([t, st]) => syncPlan(t, st)).catch(() => {});
      await hideQuick();
      await emit("tasks-changed");
    } catch (e) {
      setError(String(e));
    }
  };

  // Новое пространство из окна быстрого ввода: главное окно тоже должно его увидеть
  const createProject = async (name: string) => {
    const id = await addProject({ name, description: "", color: nextSpaceColor(projects.map((p) => p.color)), icon: "folder" }, projects.length + 1);
    setProjects(await loadProjects());
    await emit("tasks-changed");
    return id;
  };

  // Esc закрывает окно, черновик сбросится вместе с ним
  const cancel = () => hideQuick();

  return (
    <div ref={root} className="quick-root">
      <QuickForm key={key} projects={projects} tags={tags} people={people} remindBefore={remindBefore} onSave={save} onCancel={cancel} onCreateProject={createProject} profile={profileName(activeProfile())} />
      {error && <div className="error">Не сохранилось: {error}</div>}
    </div>
  );
}
