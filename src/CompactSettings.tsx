import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft } from "lucide-react";
import { setSetting } from "./db";
import { Icon } from "./icons";
import { sortsFor, directionOf, type SortBy } from "./views";
import {
  CARD_FIELDS, CARD_KEY, compactSort, HIDE_EMPTY_KEY, hideEmpty, listAccent, listIcon, listName, listOrder, moveList, ORDER_KEY,
  ROW_FIELDS, ROW_KEY, rowFields, cardHidden, sortKey, sortValue, toggleIn, ZOOM, ZOOM_KEY, zoomOf, type CardField,
} from "./compactLists";
import type { FieldId } from "./fields";
import { accelFromEvent } from "./prefs";
import { DEFAULT_COMPACT_KEY, DEFAULT_COMPACT_PREFS, EDGE_SCREENS, EDGE_SIDES, loadCompactPrefs, onCompactPrefs, setCompactKey, setCompactPlace, type CompactPrefs } from "./compactPrefs";

/*
 * Настройки компактного вида: отдельная страница в самом окне. Всё хранится в settings под ключами compact:* (см. compactLists.ts)
 * и на главное окно не влияет. После записи окно перечитывает настройки через onChanged.
 */

export default function CompactSettings({ settings, onBack, onChanged }: { settings: Record<string, string>; onBack: () => void; onChanged: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const put = (key: string, value: string) => setSetting(key, value).then(onChanged, (e) => setErr(String(e)));
  const order = listOrder(settings);
  const row = rowFields(settings);
  const hidden = cardHidden(settings);
  const zoom = zoomOf(settings);
  const [draftZoom, setDraftZoom] = useState<number | null>(null);

  // Язычок и сочетание: хранятся в compact.json (compactPrefs.ts), не в settings
  const [prefs, setPrefs] = useState<CompactPrefs>(DEFAULT_COMPACT_PREFS);
  const [recording, setRecording] = useState(false);
  const [keyErr, setKeyErr] = useState<string | null>(null);
  useEffect(() => {
    loadCompactPrefs().then(setPrefs);
    const un = onCompactPrefs(setPrefs);
    return () => void un.then((f) => f());
  }, []);
  const place = (side: CompactPrefs["side"], screen: CompactPrefs["screen"]) => setCompactPlace(side, screen).then(setPrefs, (e) => setErr(String(e)));
  const applyKey = (accel: string) => setCompactKey(accel).then((p) => (setPrefs(p), setKeyErr(null)), (e) => setKeyErr(String(e).replace(/^Error: /, "")));
  // Пока идёт запись, нажатия перехватываем, чтобы окно на них не реагировало
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape" && !e.metaKey && !e.altKey && !e.ctrlKey) return setRecording(false);
      const r = accelFromEvent(e);
      if (r === null) return;
      if (typeof r === "object") return setKeyErr(r.error);
      setRecording(false);
      applyKey(r);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="cv-set">
      <div className="cv-set-head">
        <button type="button" className="cv-back" onClick={onBack} data-tip="Назад к списку" aria-label="Назад к списку"><ChevronLeft size={16} /></button>
        <span className="cv-title">Настройки компактного вида</span>
      </div>
      <div className="cv-set-body">
        <p className="cv-hint">Эти настройки только для компактного окна, главное окно они не меняют.</p>

        <h3>Списки</h3>
        <label className="cv-check">
          <input type="checkbox" checked={hideEmpty(settings)} onChange={(e) => put(HIDE_EMPTY_KEY, e.target.checked ? "1" : "0")} />
          Прятать пустые списки
        </label>
        <div className="cv-lists">
          {order.map((v, i) => {
            const cur = compactSort(v, settings);
            const own = cur.own ? sortValue(cur.sort, cur.rev) : "";
            return (
              <div key={v} className="cv-list-set" style={{ ["--acc" as string]: `var(--${listAccent(v)})` }}>
                <span className="cv-list-ic"><Icon name={listIcon(v, settings)} size={14} /></span>
                <span className="cv-list-name">{listName(v)}</span>
                <select className="field cv-select" value={own} aria-label={`Сортировка списка «${listName(v)}»`}
                  onChange={(e) => put(sortKey(v), e.target.value)}>
                  <option value="">Как в главном окне</option>
                  {sortsFor(v).flatMap((s) => [false, true].map((rev) => (
                    <option key={sortValue(s.id as SortBy, rev)} value={sortValue(s.id as SortBy, rev)}>
                      {s.name}, {directionOf(s.id as SortBy, rev, v).text}
                    </option>
                  )))}
                </select>
                <button type="button" className="cv-mini" disabled={i === 0} aria-label="Выше" data-tip="Выше"
                  onClick={() => put(ORDER_KEY, JSON.stringify(moveList(order, v, -1)))}><ArrowUp size={13} /></button>
                <button type="button" className="cv-mini" disabled={i === order.length - 1} aria-label="Ниже" data-tip="Ниже"
                  onClick={() => put(ORDER_KEY, JSON.stringify(moveList(order, v, 1)))}><ArrowDown size={13} /></button>
              </div>
            );
          })}
        </div>

        <h3>Параметры в строке задачи</h3>
        <div className="cv-checks">
          {ROW_FIELDS.map((f) => (
            <label key={f.id} className="cv-check" data-tip={f.hint}>
              <input type="checkbox" checked={row.includes(f.id)} onChange={(e) => put(ROW_KEY, toggleIn<FieldId>(row, f.id, e.target.checked))} />
              {f.name}
            </label>
          ))}
        </div>

        <h3>Параметры в карточке задачи</h3>
        <p className="cv-hint">Пустые параметры в карточке не показываются, даже если они включены.</p>
        <div className="cv-checks">
          {CARD_FIELDS.map((f) => (
            <label key={f.id} className="cv-check">
              <input type="checkbox" checked={!hidden.includes(f.id)} onChange={(e) => put(CARD_KEY, toggleIn<CardField>(hidden, f.id, !e.target.checked))} />
              {f.name}
            </label>
          ))}
        </div>

        <h3>Язычок и сочетание клавиш</h3>
        <div className="cv-opt">
          <span className="cv-opt-name">Край экрана</span>
          <div className="cv-seg">
            {EDGE_SIDES.map((o) => (
              <button key={o.id} type="button" className={`cv-segb${prefs.side === o.id ? " on" : ""}`} aria-pressed={prefs.side === o.id} onClick={() => place(o.id, prefs.screen)}>{o.name}</button>
            ))}
          </div>
        </div>
        <div className="cv-opt">
          <span className="cv-opt-name">Монитор</span>
          <div className="cv-seg">
            {EDGE_SCREENS.map((o) => (
              <button key={o.id} type="button" className={`cv-segb${prefs.screen === o.id ? " on" : ""}`} aria-pressed={prefs.screen === o.id} data-tip={o.tip} onClick={() => place(prefs.side, o.id)}>{o.name}</button>
            ))}
          </div>
        </div>
        <div className="cv-opt">
          <span className="cv-opt-name">Сочетание</span>
          <button type="button" className={`key-rec${recording ? " rec" : ""}`} onClick={() => (setKeyErr(null), setRecording(!recording))}
            data-tip="Открывает компактный вид без мыши: стрелки и Enter. Нажми и затем нужные клавиши">
            {recording ? "Нажми сочетание…" : prefs.key ? prefs.label : "Не задано"}
          </button>
          <button type="button" className="btn small" disabled={prefs.key === DEFAULT_COMPACT_KEY} onClick={() => applyKey(DEFAULT_COMPACT_KEY)}>По умолчанию</button>
          {prefs.key && <button type="button" className="btn small" onClick={() => applyKey("")}>Убрать</button>}
        </div>
        {(keyErr || (prefs.key && !prefs.key_ok && prefs.key_error)) && <div className="cv-note err">{keyErr ?? prefs.key_error}</div>}

        <h3>Масштаб</h3>
        <div className="cv-zoom">
          <input type="range" min={ZOOM.min} max={ZOOM.max} step={ZOOM.step} value={draftZoom ?? zoom} aria-label="Масштаб компактного вида"
            onChange={(e) => setDraftZoom(Number(e.target.value))}
            onPointerUp={() => draftZoom != null && put(ZOOM_KEY, String(draftZoom)).then(() => setDraftZoom(null))}
            onKeyUp={() => draftZoom != null && put(ZOOM_KEY, String(draftZoom)).then(() => setDraftZoom(null))} />
          <span className="cv-zoom-n">{Math.round((draftZoom ?? zoom) * 100)}%</span>
          <button type="button" className="btn small" disabled={zoom === ZOOM.def && draftZoom == null} onClick={() => put(ZOOM_KEY, String(ZOOM.def))}>По умолчанию</button>
        </div>
        {err && <div className="cv-note err">Не сохранилось: {err}</div>}
      </div>
    </div>
  );
}
