import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { quickKeyLabel } from "./prefs";

/*
 * Почему не срабатывает быстрый ввод. Причин две, и macOS сообщает только о первой:
 * 1) сочетание не удалось занять (на macOS 15.0–15.1 запрещены сочетания только с ⌥) — Rust возвращает ошибку;
 * 2) сочетание заняли ещё и ChatGPT, Claude, Raycast или Alfred. Ошибки нет, но нажатие достаётся только одному
 *    приложению. Это видно только проверкой: просим нажать сочетание и ждём, дойдёт ли оно до Inbox.
 */

export interface QuickStatus {
  registered: boolean;
  error: string | null;
  conflicts: string[];
}

export const quickStatus = () => invoke<QuickStatus | null>("quick_shortcut_status").catch(() => null);

/** Плашка внизу окна, если сочетание быстрого ввода не удалось занять при запуске */
export function QuickKeyBanner(props: { error?: string | null; onSettings: () => void }) {
  const [status, setStatus] = useState<QuickStatus | null>(null);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    quickStatus().then(setStatus);
  }, [props.error]);
  const text = props.error ?? status?.error;
  if (!text || closed) return null;
  return (
    <div className="qk-banner" role="alert">
      <div>
        <b>Быстрый ввод по {quickKeyLabel()} не работает</b>
        <span>{text}. Пока можно записывать задачи кликом по иконке Inbox в строке меню.</span>
      </div>
      <button className="btn" onClick={() => (setClosed(true), props.onSettings())}>Сменить сочетание</button>
      <button className="qk-x" aria-label="Скрыть" onClick={() => setClosed(true)}>×</button>
    </div>
  );
}

const WAIT = 6;

/** Строка в настройках: «Проверить» ждёт нажатия сочетания и объясняет, если оно не дошло */
export function QuickKeyTest() {
  const [state, setState] = useState<"idle" | "wait" | "ok" | "fail">("idle");
  const [left, setLeft] = useState(WAIT);
  const [status, setStatus] = useState<QuickStatus | null>(null);
  useEffect(() => {
    quickStatus().then(setStatus);
  }, []);

  useEffect(() => {
    if (state !== "wait") return;
    const un = listen("quick-shortcut-hit", () => setState("ok"));
    const id = setInterval(() => setLeft((n) => n - 1), 1000);
    return () => {
      clearInterval(id);
      un.then((f) => f());
      invoke("test_quick_shortcut", { on: false }).catch(() => {});
    };
  }, [state]);
  useEffect(() => {
    if (state === "wait" && left <= 0) {
      setState("fail");
      quickStatus().then(setStatus);
    }
  }, [left, state]);

  const start = () => {
    setLeft(WAIT);
    setState("wait");
    invoke("test_quick_shortcut", { on: true }).catch(() => setState("fail"));
  };

  const key = quickKeyLabel();
  const others = status?.conflicts ?? [];
  let result: { cls: string; text: string } | null = null;
  if (state === "ok") result = { cls: "ok", text: `Работает: Inbox получает ${key}.` };
  else if (state === "fail")
    result = {
      cls: "bad",
      text: status && !status.registered
        ? `Inbox не смог занять ${key}${status.error ? `: ${status.error}` : ""}. Выбери другое сочетание, например с ⌃ или ⌘.`
        : others.length
          ? `Нажатие не дошло до Inbox. Скорее всего, его забирает ${others.join(" или ")}: отключи там ${key} или выбери здесь другое сочетание.`
          : `Нажатие не дошло до Inbox. Скорее всего, ${key} занято другим приложением или системой (Системные настройки → Клавиатура → Сочетания клавиш). Выбери другое сочетание.`,
    };

  return (
    <>
      <div className="set-row">
        <div className="set-text">
          <div className="set-name">Проверка</div>
          <div className="hint">
            {state === "wait" ? `Нажми ${key} сейчас… ${left}` : "Проверяет, доходит ли нажатие до Inbox"}
            {state === "idle" && others.length > 0 && (
              <> · <span className="qk-warn">{key} могут занимать и запущенные {others.join(", ")}</span></>
            )}
          </div>
        </div>
        <div className="set-ctl">
          <button type="button" className="btn" disabled={state === "wait"} onClick={start}>
            {state === "wait" ? "Жду нажатия" : "Проверить"}
          </button>
        </div>
      </div>
      {result && <div className={`qk-result ${result.cls}`}>{result.text}</div>}
    </>
  );
}
