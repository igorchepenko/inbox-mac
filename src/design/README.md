# Inbox

Inbox is a personal task manager for macOS (Tauri + React, system fonts, Lucide icons). Capture takes two seconds with ⌥Space, tasks land in «На разбор», and once a day you sort them. This system is the standardized version of the app's styles: where the code drifted, the tokens here are the target and the **Audit** section lists every change.

## Content fundamentals

- **Language:** Russian, informal «ты» («Записываешь задачу за пару секунд», «Завершить всё равно?»). Address the person directly; no «пользователь».
- **Casing:** sentence case everywhere, including buttons («Записать человека», «Новый тег»). Only section labels are set UPPERCASE through the `label` style, never typed in caps.
- **Buttons are verbs;** states are nouns or participles («Жду», «Разобрано», «Завершённые»). Counts are digits («Блокирует: 2», «+3»).
- **No emoji, no exclamation marks.** Symbols that carry meaning are keyboard glyphs (⌥ ⌘ ⇧) in `kbd`, a check ✓ in a ring, and the Lucide icon set.
- **Smart-list names:** Новые, Сегодня, Скоро, Жду, Завершённые, Календарь. Quadrant and priority names are fixed words (Минимальная … Максимальная); do not rename them in UI copy.
- Errors say what to do next in one sentence, in `danger-text`, never a bare code. Confirmations ask a question («Завершить всё равно?») with the verb as the button.

## Visual foundations

- **Two looks only: Light and Dark** (themes `light`, `dark`; follows the system unless the person chooses). The translucent "Glass" look is intentionally not part of this system.
- **Color roles.** Neutrals: `bg` ground, `side` sidebar, `surface` cards/rows/dialogs, `field` inputs. Text: `fg`, secondary `muted`. Four status hues, each with a fill, a `*-text` and an `on-*`: `accent` (teal; selection, today, links, focus), `danger` (crimson; brand, main action, overdue, errors), `success` (green; done, toggles), `warning` (amber; due soon, ping). Plus `info` blue, `caution` orange, `meeting` violet, `neutral` graphite.
- **Fill vs text.** A fill color is for backgrounds, rings, borders and icons ≥3:1. Text in a status hue uses its `*-text`. Text on a fill uses its `on-*`. Do not write `#fff`.
- **Spaces** get one of 40 `swatch-*` colors, shown as a 14–26% tint, dot and icon, with the name always in `fg`. A solid swatch fill takes `swatch-*-ink`.
- **Priority and quadrant colors** are `priority-1…5` and `quadrant-1…4`, aliases of the status hues. Shape (chevrons) carries priority first.
- **Type.** System font (`font-sans`, SF) and `font-mono` for dates, counts and keys. Nine text styles from `micro` 10 to `page-title` 22; body is 13px, and 12px is the workhorse. Weights 400, 500, 600, 700 only. Mono numbers are tabular.
- **Spacing:** the `space-1…7` ladder (2, 4, 6, 8, 12, 16, 24). Rows: 8 × 12. Panels: 16. Window gutter: 24.
- **Radii:** `radius-xs…2xl` (4, 6, 8, 12, 16, 22) and `radius-full`. Controls 8, rows and buttons 12, widgets and popovers 16, dialogs 22.
- **Borders:** `line` for hairlines between things, `border` for the edge of cards and labeled buttons, `border-control` (3:1) for fields, toggles and checkboxes. Dividers inside panels may fade at both ends.
- **Shadows:** `shadow-card` on home widgets, `shadow-overlay` on dialogs, popovers, tooltips and the close X, `shadow-drag` on a card in hand. Everything else is flat with a hairline.
- **States:** hover is `hover` wash on quiet controls and a 7% accent tint on rows and cards; selected is `selected` or a 10% accent tint with a 55% border; pressed is `pressed` plus a 1px press; disabled is 45% opacity. Focus is a 2px `focus` ring, offset 2px, on every focusable element; never remove it.
- **Motion:** `dur-fast` 100ms for hover and opacity, `dur-base` 150ms for control changes, `dur-slow` 200ms for lifts and drops, always `ease-out`. Nothing loops.
- **Layout:** three columns, sidebar 220, content, detail 340. The row collapses its extras as it narrows. Scrollbars are 10px with a 4px thumb. Overlays use a `scrim` with blur(6px). Layers: `z-raised`, `z-sticky`, `z-overlay`, `z-popover`, `z-tooltip`, `z-drag`.
- **Imagery:** none; the product has no photos or illustration. The home dashboard uses the Fitness-style rings as its one graphic idea.

## Iconography

Lucide (`lucide-react`), stroke width 2.2, round caps and joins, `currentColor`, 16px by default and 14px inside meta text. The set used for spaces is 38 named icons (inbox, sun, calendar, folder, briefcase, users, house, star, heart, …) stored by name in the database, so names are stable. Priority is a custom five-glyph chevron set (see PriorityIcon). The app icon is a crimson squircle with a white check-bolt; the tray icon is a black template glyph (macOS tints it). Both live in `assets/Logos`.

## Using the system

- Build screens from the components listed here; their class names and states are in `components/bundle.css`.
- Never introduce a hex value, a radius, a gap, a font size or a z-index that is not a token. If you need a new one, add it to `tokens.json` first.
- A new status needs a fill, a `-text` and an `on-` token, checked 4.5:1 in both themes, before it is used.
- Put one primary button in a view. Put every task into the same TaskRow, in a list or in a widget, with the same checkbox.
