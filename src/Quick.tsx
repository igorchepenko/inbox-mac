import { useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { addTask, loadProjects } from "./db";
import { QuickForm } from "./components";

const hideQuick = () => invoke("hide_quick");

/** Окно ⌥Space: маленькая карточка поверх всех приложений */
export default function QuickApp() {
  // Новый ключ пересоздаёт форму с пустыми полями. Делаем это до того, как окно спрячется,
  // а не при открытии: иначе первые буквы, набранные сразу после ⌥Space, потеряются
  const [key, setKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const win = getCurrentWindow();

  useEffect(() => {
    loadProjects().catch(() => {}); // заранее открыть базу, чтобы первое сохранение было мгновенным
    const focusTitle = () => document.querySelector<HTMLInputElement>(".qi-title")?.focus();
    const un = [listen("quick-open", focusTitle), win.onFocusChanged(({ payload }) => payload && focusTitle())];
    return () => un.forEach((p) => p.then((f) => f()));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (title: string, note: string) => {
    try {
      await addTask(title, note);
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
    <div className="quick-root">
      <QuickForm key={key} onSave={save} onCancel={cancel} />
      {error && <div className="error">Не сохранилось: {error}</div>}
    </div>
  );
}
