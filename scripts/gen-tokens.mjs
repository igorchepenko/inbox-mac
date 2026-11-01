// Генерирует src/design/tokens.css из src/design/tokens.json.
// Светлая тема в :root; тёмная один раз в @media (prefers-color-scheme: dark) и один раз в [data-theme="dark"].
// Запуск: node scripts/gen-tokens.mjs   (проверка без записи: node scripts/gen-tokens.mjs --check)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src/design/tokens.json");
const out = join(root, "src/design/tokens.css");
const t = JSON.parse(readFileSync(src, "utf8"));

const val = (v, theme) => {
  const s = typeof v === "string" ? v : (v[theme] ?? v.light);
  const m = /^\{([\w.-]+)\}$/.exec(s);
  return m ? `var(--${m[1]})` : s;
};

const light = [];
const dark = [];
const add = (name, v) => {
  const l = val(v, "light");
  const d = val(v, "dark");
  light.push(`  --${name}: ${l};`);
  if (d !== l) dark.push(`  --${name}: ${d};`);
};

for (const fam of ["color", "shadow", "spacing", "radius", "size", "zIndex", "timing"]) {
  light.push(`  /* ${fam} */`);
  for (const tok of t[fam].tokens) add(tok.name, tok.value);
}
light.push("  /* type */");
for (const [k, v] of Object.entries(t.type.families)) light.push(`  --font-${k}: ${v};`);
for (const g of t.type.groups) {
  for (const s of g.styles) {
    light.push(`  --fs-${s.name}: ${s.fontSize};`);
    light.push(`  --lh-${s.name}: ${s.lineHeight};`);
    light.push(`  --fw-${s.name}: ${s.fontWeight};`);
    if (s.letterSpacing) light.push(`  --ls-${s.name}: ${s.letterSpacing};`);
  }
}

const css = `/* ${t.name} — generated from tokens.json (node scripts/gen-tokens.mjs). Не править вручную. */
:root {
  color-scheme: light;
${light.join("\n")}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
${dark.map((l) => "  " + l).join("\n")}
  }
}

:root[data-theme="dark"] {
  color-scheme: dark;
${dark.join("\n")}
}
`;

if (process.argv.includes("--check")) {
  let cur = "";
  try { cur = readFileSync(out, "utf8"); } catch { /* нет файла */ }
  if (cur !== css) { console.error("tokens.css не соответствует tokens.json: запусти node scripts/gen-tokens.mjs"); process.exit(1); }
} else {
  writeFileSync(out, css);
  console.log(`tokens.css: ${light.length} строк светлой темы, ${dark.length} тёмных значений`);
}
