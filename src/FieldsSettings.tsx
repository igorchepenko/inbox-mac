import type { ReactNode } from "react";
import { Columns3, List } from "lucide-react";
import { ResetSection, Toggle } from "./Settings";
import type { Layout } from "./boardOps";
import { DEFAULT_FIELDS_VALUE, DEFAULT_HIDDEN, FIELDS, fieldsChanged, fieldsKey, hiddenFields, toggleField } from "./fields";

/*
 * Раздел «Поля задач» в настройках: какие поля видны в строке списка и на карточке канбана.
 * Только рабочая область, форма записи и панель задачи показывают всё как раньше. Логика и ключи в src/fields.ts.
 */

const LAYOUTS: { id: Layout; name: string; icon: ReactNode }[] = [
  { id: "list", name: "Список", icon: <List size={13} /> },
  { id: "board", name: "Канбан", icon: <Columns3 size={13} /> },
];

export function FieldsSettings(props: { settings: Record<string, string>; onSet: (key: string, value: string) => void }) {
  const s = props.settings;
  const hidden = { list: hiddenFields(s, "list"), board: hiddenFields(s, "board") };
  const changed = LAYOUTS.some((l) => fieldsChanged(s, l.id));
  return (
    <div className="set-group">
      <div className="hint">
        Что видно у задачи в списке и на карточке канбана, кроме названия и галочки. Форма записи и панель задачи справа показывают все поля.
        При наведении на любой элемент задачи появляется подсказка с подробностями.
      </div>
      <div className="fields-grid" role="table" aria-label="Поля задач">
        <div className="fields-head" role="row">
          <span role="columnheader" />
          {LAYOUTS.map((l) => <span key={l.id} role="columnheader" className="fields-col">{l.icon} {l.name}</span>)}
        </div>
        {FIELDS.map((f) => {
          const def = LAYOUTS.filter((l) => f.layouts.includes(l.id) && DEFAULT_HIDDEN[l.id].includes(f.id)).length > 0;
          return (
            <div key={f.id} className="fields-row" role="row">
              <div className="set-text" role="cell">
                <div className="set-name">{f.name}</div>
                <div className="hint">{f.hint}{def ? ". Изначально скрыто" : ""}</div>
              </div>
              {LAYOUTS.map((l) => (
                <div key={l.id} className="fields-col" role="cell">
                  {f.layouts.includes(l.id) ? (
                    <Toggle label={`${f.name}: показывать в виде «${l.name}»`} on={!hidden[l.id].includes(f.id)}
                      onChange={(on) => props.onSet(fieldsKey(l.id), toggleField(s, l.id, f.id, on))} />
                  ) : <span className="hint">—</span>}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <ResetSection name="Поля задач" changed={changed}
        onReset={() => LAYOUTS.forEach((l) => fieldsChanged(s, l.id) && props.onSet(fieldsKey(l.id), DEFAULT_FIELDS_VALUE(l.id)))} />
    </div>
  );
}
