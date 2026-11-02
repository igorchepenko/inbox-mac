import { useEffect, useState, type ReactNode } from "react";
import { markReleasesSeen } from "./releases";
import { activeProfile, createProfile, useProfiles } from "./profile";

/** Пока нет ни одного профиля, вместо приложения экран создания. Базу до этого никто не открывает */
export function ProfileGate({ quick, children }: { quick: boolean; children: ReactNode }) {
  useProfiles();
  if (activeProfile()) return <>{children}</>;
  return quick ? (
    <div className="profile-setup quick">Сначала создай профиль в главном окне Inbox</div>
  ) : (
    <ProfileSetup />
  );
}

export function ProfileSetup() {
  // Первая установка: окно новинок новичку не нужно, запоминаем текущую версию как показанную
  useEffect(() => void markReleasesSeen(__APP_VERSION__), []);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const e = await createProfile(name);
    if (e) (setErr(e), setBusy(false));
  };
  return (
    <div className="profile-setup">
      <form onSubmit={(e) => (e.preventDefault(), submit())}>
        <h1>Создай профиль</h1>
        <p>У профиля свои задачи, пространства и настройки. Название и есть имя профиля. Потом его можно поменять, а профилей можно завести несколько: они никак не связаны.</p>
        <input className="field" autoFocus maxLength={40} value={name} placeholder="Например, Работа" spellCheck={false}
          onChange={(e) => (setName(e.target.value), setErr(null))} />
        {err && <div className="error">{err}</div>}
        <button type="submit" className="btn small primary" disabled={!name.trim() || busy}>Создать</button>
      </form>
    </div>
  );
}
