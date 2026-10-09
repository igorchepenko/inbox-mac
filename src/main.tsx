import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import QuickApp from "./Quick";
import "./styles.css";

// Одна сборка на два окна: главное и быстрый ввод (index.html?window=quick)
const isQuick = new URLSearchParams(location.search).get("window") === "quick";
document.documentElement.classList.toggle("quick", isQuick);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isQuick ? <QuickApp /> : <App />}</React.StrictMode>,
);
