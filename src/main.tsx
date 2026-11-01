import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import QuickApp from "./Quick";
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

// Одна сборка на два окна: главное и быстрый ввод (index.html?window=quick)
const isQuick = new URLSearchParams(location.search).get("window") === "quick";
document.documentElement.classList.toggle("quick", isQuick);

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
      <ProfileGate quick={isQuick}>{isQuick ? <QuickApp /> : <App />}</ProfileGate>
    </React.StrictMode>,
  );
});
