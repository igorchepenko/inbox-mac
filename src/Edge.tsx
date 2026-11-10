import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Inbox } from "lucide-react";
import { loadTasks } from "./db";
import { activeProfile } from "./profile";
import { countFor } from "./views";
import { loadCompactPrefs, onCompactPrefs, type EdgeSide } from "./compactPrefs";
import "./compact.css";

/*
 * Значок у края экрана (окно edge), справа или слева — из настроек компактного вида. Наведение, клик и перетаскивание ловит src-tauri/src/compact.rs,
 * здесь только картинка: иконка Inbox и сколько задач на сегодня
 */
export default function EdgeApp() {
  const [open, setOpen] = useState(false);
  const [today, setToday] = useState(0);
  const [side, setSide] = useState<EdgeSide>("right");
  useEffect(() => {
    const count = () => {
      if (!activeProfile()) return;
      loadTasks().then((t) => setToday(countFor("today", t))).catch(() => {});
    };
    count();
    loadCompactPrefs().then((p) => setSide(p.side));
    // Счётчик меняется от задач из любого окна и при смене дня
    const id = setInterval(count, 60_000);
    const un = [listen<boolean>("edge-state", (e) => setOpen(e.payload)), listen("tasks-changed", count), onCompactPrefs((p) => setSide(p.side))];
    return () => (clearInterval(id), un.forEach((p) => p.then((f) => f())));
  }, []);
  return (
    <div className={`edge${open ? " on" : ""}${side === "left" ? " left" : ""}`} aria-label="Inbox">
      <Inbox size={15} strokeWidth={2.2} />
      {today > 0 && <span className="edge-n">{today > 99 ? "99+" : today}</span>}
    </div>
  );
}
