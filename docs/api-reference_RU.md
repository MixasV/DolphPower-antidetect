# Справочник API

DolfPower предоставляет полноценный REST API, работающий по умолчанию на `http://127.0.0.1:3001`.

## Аутентификация и Безопасность

### Инициализация Auth
`POST /v1.0/auth/initialize`
Используется для установки первого мастер-пароля.
**Тело запроса:** `{ "password": "..." }`

### Логин
`POST /v1.0/auth/login`
Разблокирует мастер-ключ в оперативной памяти.
**Тело запроса:** `{ "password": "..." }`

### Логаут
`POST /v1.0/auth/logout`
Очищает мастер-ключ и токены безопасности из памяти.

## Профили

### Список профилей
`GET /v1.0/browser_profiles`

### Создание профиля
`POST /v1.0/browser_profiles/create`
**Тело запроса:**
```json
{
  "name": "Мой новый профиль",
  "template": "windows_chrome",
  "proxy_id": "optional_id",
  "fingerprint_config": {
    "canvas": { "mode": "noise", "noise": 10 },
    "webgl": { "mode": "noise" }
  }
}
```

### Запуск браузера
`GET /v1.0/browser_profiles/:id/start`
**Параметры запроса:**
- `headless=true`: Запуск без графического интерфейса.
- `automation=true`: Возвращает WebSocket endpoint для Puppeteer.

### Остановка браузера
`GET /v1.0/browser_profiles/:id/stop`

## Миграция

### Обнаружение браузеров
`GET /v1.0/migration/detect`
Поиск поддерживаемых антидетект-браузеров в системе.

### Список профилей
`GET /v1.0/migration/list/:browser`
Список профилей конкретного браузера (например, `dolphin`, `adspower`).

### Перенос профиля
`POST /v1.0/migration/migrate`
Перенос выбранного профиля в DolfPower.
**Тело:** `{ "profile": { "id": "...", "name": "...", "browser": "...", "path": "..." } }`

### Глубокое сканирование
`POST /v1.0/migration/deep-scan`
Поиск данных профилей в указанной папке.
**Тело:** `{ "path": "C:\\Custom\\Path" }`

## ИИ Jarvis

### Чат с Jarvis
`POST /v1.0/jarvis/chat`
**Тело запроса:**
```json
{
  "message": "Запусти все мои профили в группе 'Crypto'",
  "session_id": "optional_session_uuid",
  "history": [],
  "attached_files": []
}
```

### Создание задачи (Планировщик/RPA)
`POST /v1.0/jarvis/tasks`
**Тело запроса:**
```json
{
  "name": "Daily Farm",
  "script_id": "rpa_scenario_id",
  "profile_ids": ["id1", "id2"],
  "repeat_interval": 1440,
  "cron_expression": "0 9 * * 1"
}
```

## Прокси

### Создание прокси
`POST /v1.0/proxies/create`

### Массовый импорт
`POST /v1.0/proxies/bulk/import`
**Тело запроса:**
```json
{
  "proxies_text": "host:port:user:pass\nhost2:port2",
  "default_protocol": "socks5"
}
```

### Тестирование прокси
`POST /v1.0/proxies/:id/test`

## RPA Движок

### Создание сценария
`POST /v1.0/rpa/scenarios/create`
**Тело запроса:**
```json
{
  "name": "Login Gmail",
  "actions": [
    { "type": "navigate", "url": "https://gmail.com" },
    { "type": "type", "selector": "#identifierId", "text": "user@gmail.com" }
  ]
}
```

## Система

### Проверка состояния (Health Check)
`GET /health`

### Завершение работы
`POST /system/shutdown`
Завершает работу всех запущенных экземпляров Chromium.

---

*Примечание: Полные JSON-схемы и дополнительные эндпоинты (куки, расширения, группы) доступны в файле API.md в корне репозитория.*

