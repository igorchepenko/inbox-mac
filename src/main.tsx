import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import QuickApp from "./Quick";
import CompactApp from "./Compact";
import EdgeApp from "./Edge";
import "./styles.css";
import "./task.css";
import "./nav.css";
import "./frame.css";
import "./space.css";
import "./profile.css";
import "./tags.css";
import "./status.css";
import "./people.css";
import "./glass.css";
import { installPalette } from "./palette";
import { applyLook, applyTheme, followLookChanges, followThemeChanges, savedLook, savedTheme } from "./theme";
import { applyAppearance, followAppearanceChanges, savedAppearance } from "./prefs";
import { followProfileChanges, loadProfiles } from "./profile";
import { ProfileGate } from "./ProfileSetup";

// Одна сборка на все окна: главное, быстрый ввод (index.html?window=quick),
// значок у края экрана (window=edge) и компактный вид (window=compact). У трёх последних прозрачный фон (класс quick)
const kind = new URLSearchParams(location.search).get("window");
const isQuick = kind === "quick" || kind === "edge" || kind === "compact";
document.documentElement.classList.toggle("quick", isQuick);
if (kind === "edge" || kind === "compact") document.documentElement.classList.add(kind);

function Root() {
  if (kind === "edge") return <EdgeApp />;
  if (kind === "compact") return <CompactApp />;
  return isQuick ? <QuickApp /> : <App />;
}

// Сначала список профилей: тема, внешний вид и база зависят от активного
loadProfiles().finally(() => {
  followProfileChanges(!isQuick);
  installPalette();
  applyTheme(savedTheme());
  followThemeChanges();
  applyLook(savedLook());
  followLookChanges();
  applyAppearance(savedAppearance());
  followAppearanceChanges();

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      {kind === "edge" ? <Root /> : <ProfileGate quick={isQuick}><Root /></ProfileGate>}
    </React.StrictMode>,
  );
});
