# Google Link

## Описание
Tampermonkey userscript для Waze Map Editor (WME), который автоматически ищет и привязывает Google POI по адресу выбранного POI.

## Структура
- `src/wme-google-link.user.js` — основной скрипт

## Как работает v1.20.12
1. При клике на POI в WME скрипт получает адрес через WME SDK
2. Строит поисковый запрос из улицы + номера дома + города + страны
3. Показывает плавающую панель "🔍 Google Link" справа
4. Автоматически ищет через Google Places AutocompleteService
5. Показывает результаты с адресом, телефоном, рейтингом
6. Кнопка "🔗 Link this Google Place" открывает Google Maps для верификации

## Технологии
- WME JavaScript SDK (`getWmeSdk`)
- `W.selectionManager.events` (legacy events для надёжности)
- Google Places API: `AutocompleteService` + `PlacesService`
- Drag-and-drop панель (перетаскивание за заголовок)

## Ключевые селекторы WME (изучено)
- `#edit-panel` — главная панель редактирования
- `#left-panel` — левая панель
- `venue.externalProviderIds` — массив Google Place ID'ов
- `W.selectionManager.selectedItems` — выбранные элементы
- `W.selectionManager.events.register("selectionchanged", ...)` — событие выбора

## Важные фиксы
### v1.20.13 — Ускорение автозаполнения + единая версия
- Интервал ретраев в `waitAndFill` / `waitForPac` уменьшен **300 мс → 100 мс** (поля и дропдауны подхватываются в 3 раза быстрее)
- Константа `GL_VERSION` — версия в консоли и заголовке панели берётся из одного места (синхронизировать с `@version`)
- ⚠️ GitHub Pages **не используется** — скрипт обновляется только через репозиторий (`raw.githubusercontent.com/EdjOne/google-link/master/src/wme-google-link.user.js`)

### v1.20.12 — Пропуск природы/парковок
- `isSkippedCategory` проверяет категории веню по **имени** (строка, e.g. `"SEA_LAKE_POOL"`, `"FOREST"`, `"FARM"`, `"PARKING_LOT"`) и по **ID-префиксу** (49xx = парковки, 69xx = природа)
- Сначала SDK модель (там всегда populated), fallback на legacy
- Дебаг-логи включены: `[GL] isSkipped ...`

### v1.20.7 — Хайлайт через CSS `!important`
- Вместо `setAttribute('stroke', ...)` — CSS `<style>` блок с правилами по ID иконки + `!important`
- Переживает ховер WME без сброса

### v1.20.6 — Хайлайт после загрузки данных
- Хендлер на `wme-map-data-loaded` — хайлайт не пропадает после подгрузки карты

## TODO
- [ ] Протестировать в реальном WME — проверить работу Google Places API
- [ ] Добавить прямое связывание Place ID с venue (без открытия Google Maps)
- [ ] Автоматический выбор лучшего совпадения по имени
- [ ] Настройки: радиус поиска, типы мест, автопривязка

## История
- 2026-06-02: v1.0.0 — первая версия с DOM-подходом (кнопка в панели)
- 2026-06-02: v1.1.0 — переписан на Google Places API + плавающая панель
- 2026-07: v1.20.5–1.20.12 — пропуск природы/парковок, CSS-хайлайт, автообновление
- 2026-08-20: v1.20.13 — ускорение автозаполнения (300→100 мс), единая константа версии
