# Audit

What was found reading `igorchepenko/inbox-mac` at 0.19.0 (15 CSS files, `palette.ts`, `priority.tsx`), what this system changes, and what still needs a code change. **Ready** means the token or component here already carries the fix; **Code** means the app still has to adopt it (see Migration).

## Summary

| # | Finding | Severity | State |
|---|---|---|---|
| 1 | Accent, success and warning used as **text** miss 4.5:1 (3.5, 3.4, 3.3 on surface; 2.8 on bg) | High | Ready: `*-text` tokens |
| 2 | White text on teal, green and amber fills is 3.8, 3.6 and 3.5:1; white on crimson in dark is 4.0 | High | Ready: `on-*` tokens |
| 3 | Focus ring is the accent teal: 2.8:1 on bg; several inputs drop the ring for a 1px border | High | Ready: `focus` + Field |
| 4 | Space ink rule gives white at 2.8–4.2:1 on 28 of 80 fills (13 light, 15 dark) | High | Ready: `swatch-*-ink` |
| 5 | Field, toggle and checkbox edges are `border`/`line`: 1.3–1.7:1 | Medium | Ready: `border-control` |
| 6 | Priority 1 (2.7:1) and priority 3 (2.5:1) glyphs are under 3:1 in light | Medium | Ready |
| 7 | Dark theme values are copied 3–4 times (`styles.css` ×2, `task.css` ×2, `palette.ts` ×2) | Medium | Code |
| 8 | Palette ids `blue`, `violet`, `orange` shadow the system colors through a `:root:root` override | Medium | Ready: `info`, `meeting`, `caution` |
| 9 | Color names are ring metaphors (`move`, `exercise`, `stand`, `goal`) and `stand` is five roles at once | Medium | Ready: semantic names |
| 10 | 20 border radii, 19 font sizes, 10 gaps, 14 z-index values, 5 durations | Medium | Ready: scales |
| 11 | Five near-identical pill/chip components | Medium | Ready: Chip, Tag, SegmentedControl |
| 12 | Three checkbox sizes (15, 17, native) and a look-dependent shape | Low | Ready: Checkbox 18 |
| 13 | Six control heights: 22, 24, 26, 28, 30, 32 | Low | Ready: `size-ctl-*` |
| 14 | Hard-coded `#fff`, `rgba(0,0,0,.45)` shadows in 3 CSS files | Low | Ready |
| 15 | Tooltip and drag ghost both at z-index 50 | Low | Ready |
| 16 | Dead CSS: `glass.css` ends with a declaration block that has no selector | Low | Code |
| 17 | 40-color palette has near-duplicates and 20 swatches under 3:1 on surface in light | Low | Note |
| 18 | Four hover recipes (5, 6, 8, 10% `fg` mixes) | Low | Ready: `hover`, `pressed` |

## Details

### 1–3. Contrast (Ready)

Measured on the actual grounds (`surface` #F6F8FB, `bg` #D9DEE7, `field`, `side`; dark #22262D and others). The dark theme passes everywhere except crimson with white text, so every fix below is for the light theme unless stated.

| Pair | Was | Now |
|---|---|---|
| Teal text `#0890AA` on surface / bg | 3.5 / 2.8 | `accent-text` #066B7E ≥ 4.5 |
| Green text `#3C9A0C` on surface | 3.4 | `success-text` #2C7009 |
| Amber text `#C27A00` on surface | 3.3 | `warning-text` #8A5700 |
| Crimson text `#E0104F` on bg | under 4.5 | `danger-text` #C10E44 |
| White on teal fill | 3.8 | `on-accent` #161B26, 4.6 |
| White on green fill | 3.6 | `on-success` #161B26, 4.8 |
| White on crimson fill, dark | 4.0 | `on-danger` #0D0F12, 4.8 |
| Focus ring on bg | 2.8 | `focus` = `accent-text` |

The fills themselves keep the brand values: they meet 3:1 as rings, borders and icons, which is what they are used for.

### 4. Space ink

`inkFor()` keeps white until relative luminance reaches 0.33, which allows white text down to 2.8:1 (orange, rose, lilac, teal, coral). Now `swatch-<id>-ink` is whichever of white or `#0D0F12` has the higher contrast; every one of the 80 swatch fills reaches 4.5:1. Some badges flip from white to black text (scarlet, coral, orange in light); this is the visible cost.

### 5. Control edges

`line` is 1.3:1 and `border` 1.6:1 on `surface`. Both stay for cards and labeled buttons. Unlabeled controls (fields, toggles, checkboxes) use `border-control`, ≥3:1 in both themes.

### 7–9. Token structure

- The dark overrides appear in `@media (prefers-color-scheme: dark)` and again in `[data-theme="dark"]`, in three files plus the generated `palette.ts` CSS. One edit has to be made in up to four places. Generate `tokens.css` from `tokens.json` and write the dark block once.
- `palette.ts` declares `blue`, `violet`, `orange` as swatches and overwrites `--blue`, `--violet`, `--orange` with `:root:root`. The system `--orange` (#E2640F) is silently replaced by the swatch (#FF6A00) wherever it is read. Swatches are now `swatch-*` and cannot collide.
- `goal` and `exercise` are the same green in meaning and nearly in value; `goal` is dropped. `priority-5` (#E0102F) duplicated `danger` (#E0104F); `quadrant-*` and `priority-2/3/4` repeated `info`, `warning`, `caution` as raw hex in a separate file. They are aliases now.

### 10. Scales

| Axis | Source | Now |
|---|---|---|
| Radius | 1 2 3 4 5 6 7 8 9 10 11 12 14 16 17 18 22 50% 999 | 4 6 8 12 16 22 full |
| Font size | 7 9.5 10 10.5 11 11.5 12 12.5 13 14 15 16 17 18 19 20 22 24 44 | 10 11 12 13 15 17 22 |
| Weight | 400 500 600 700 800 | 400 500 600 700 |
| Gap | 1 2 3 4 5 6 7 8 10 12 | 2 4 6 8 12 16 24 |
| z-index | 0 1 2 3 4 5 6 8 9 10 20 40 50 100 | 2 4 10 20 40 50 |
| Duration | .1 .12 .15 .18 .2 s | 100 150 200 ms |

Snapping rules are in each family's note. Largest visible shifts: dialogs 18→22px, window gutter 22→24px, page title weight 800→700.

### 11–13. Components

`.chip`, `.stage-seg button`, `.fchip`, `.tchip`, `.sugg-i` are five pill variants with different borders and sizes. They fold into **Chip** (selectable), **Tag** (label), **SegmentedControl** (exclusive), and filters use Chip. The task checkbox is 17px, the multi-select box is a 15px native input with `accent-color`, the card box is `kchk`: one **Checkbox** at 18px now. Header controls are 26 (search), 28 (project search), 30 (`--ctl-h`), 32 (tag input): all 30 now, 36 in forms.

### 14–16. Cleanup (Code)

- `#fff` in `board.css`, `status.css`, `space.css`: use `on-success`, `on-danger`.
- Shadows `0 18px 40px -18px` and `-24px` coexist; one `shadow-overlay`.
- `glass.css` last lines (`/* Настройки фона… */ background: var(--pane)…}`) have no selector and are ignored by the browser. Delete them. The whole Glass look is outside this system; if it is dropped from the app, `glass.css`, `data-look`, the `pane/edge/wall` variables and the per-look radii go with it.
- `.tip` and `.drag-ghost` are both `z-index: 50`.

### 17. Palette

Out of 40: `royal`/`blue`/`cornflower`, `lemon`/`sunflower`/`gold`, `neon`/`lime`/`chartreuse`, `orange`/`tangerine`/`coral` are near-neighbors, and 20 of 40 are under 3:1 against `surface` in light (lemon 1.2, chartreuse 1.2, neon 1.3, sunflower 1.5, aqua 1.6). As tint + dot + always-printed name they are usable; as a sole cue they are not. Ids stay (they are stored in user databases). Recommendation: show 24 in the picker, keep all 40 resolvable.

## Migration

1. Generate `tokens.css` from `tokens.json`; delete the dark blocks from `styles.css`, `task.css`, `palette.ts`.
2. Add aliases for one release so old selectors keep working, then remove:

| Old | New |
|---|---|
| `--stand` | `--accent` (fills, rings) / `--accent-text` (text, links) |
| `--move` | `--danger` / `--danger-text` |
| `--exercise`, `--goal` | `--success` / `--success-text` |
| `--amber` | `--warning` / `--warning-text` |
| `--blue`, `--orange`, `--violet` | `--info`, `--caution`, `--meeting` |
| `--graphite` | `--neutral` |
| `--sel` | `--selected` |
| `--ring-track` | `--track` |
| `--card-shadow` | `--shadow-card` |
| `--p1…5`, `--q1…4` | `--priority-N`, `--quadrant-N` |
| `--<space id>`, `--<id>-ink` | `--swatch-<id>`, `--swatch-<id>-ink` |
| `--ctl-h` | `--size-ctl-md` |

3. Replace `color: #fff` on fills with `on-*`; swap `:focus-visible` outlines to `--focus`; set `border-color: var(--border-control)` on `.field`, `.toggle`, `.chk`.
4. Replace radii, gaps and font sizes with tokens file by file; the table in section 10 gives the mapping. Do it with a lint rule rather than by hand.
