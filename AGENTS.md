# Google Link

## Описание
Tampermonkey userscript для Waze Map Editor (WME), который автоматически ищет и привязывает Google POI по адресу выбранного POI.

## Структура
- `src/wme-google-link.user.js` — основной скрипт

## Как работает v1.1.0
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

## TODO
- [ ] Протестировать в реальном WME — проверить работу Google Places API
- [ ] Добавить прямое связывание Place ID с venue (без открытия Google Maps)
- [ ] Автоматический выбор лучшего совпадения по имени
- [ ] Настройки: радиус поиска, типы мест, автопривязка

## История
- 2026-06-02: v1.0.0 — первая версия с DOM-подходом (кнопка в панели)
- 2026-06-02: v1.1.0 — переписан на Google Places API + плавающая панель
