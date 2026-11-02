import { useEffect } from "react";
import { CloseX } from "./widgets";
import { fmtReleaseDate, RELEASES } from "./releases";
import "./releases.css";

/** Событие «открой историю версий»: его шлёт кнопка в Настройки → О приложении, слушает App */
export const RELEASES_EVENT = "inbox-releases";

/** Окно истории версий: новые релизы сверху. То же окно встречает пользователя при первом запуске новой версии */
export function Releases({ onClose }: { onClose: () => void }) {
  // Esc закрывает только это окно, а не настройки под ним
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [onClose]);

  return (
    <div className="overlay rel-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="help rel" role="dialog" aria-label="История версий">
        <CloseX onClick={onClose} />
        <div className="help-head">
          <h3>История версий</h3>
        </div>
        <div className="rel-body">
          {RELEASES.map((r) => (
            <section className="rel-item" key={r.version}>
              <h4>Версия {r.version} · {fmtReleaseDate(r.date)}</h4>
              <ul>
                {r.items.map((t) => <li key={t}>{t}</li>)}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
