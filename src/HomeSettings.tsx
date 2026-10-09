/**
 * Раздел «Главная» в настройках. Пока заготовка: сюда добавятся видимость и порядок блоков главной страницы,
 * когда появится она сама. Значения хранить в таблице settings с префиксом home. (например, home.blocks).
 */
export function HomeSettings(_props: { settings: Record<string, string>; onSet: (key: string, value: string) => void }) {
  return (
    <div className="set-group">
      <div className="set-row">
        <div className="set-text">
          <div className="set-name">Блоки главной страницы</div>
          <div className="hint">
            Здесь можно будет выбрать, какие блоки показывать на главной (итоги дня, ближайшие задачи, неделя, статистика),
            и расставить их в нужном порядке перетаскиванием.
          </div>
        </div>
        <span className="set-soon">Скоро</span>
      </div>
    </div>
  );
}
