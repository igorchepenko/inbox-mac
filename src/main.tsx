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
import { installPalette } from "./palette";
import { applyTheme, followThemeChanges, savedTheme } from "./theme";
import { applyAppearance, followAppearanceChanges, savedAppearance } from "./prefs";
import { followProfileChanges } from "./profile";

// Одна сборка на два окна: главное и быстрый ввод (index.html?window=quick)
const isQuick = new URLSearchParams(location.search).get("window") === "quick";
document.documentElement.classList.toggle("quick", isQuick);
followProfileChanges(!isQuick);
installPalette();
applyTheme(savedTheme());
followThemeChanges();
applyAppearance(savedAppearance());
followAppearanceChanges();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isQuick ? <QuickApp /> : <App />}</React.StrictMode>,
);
