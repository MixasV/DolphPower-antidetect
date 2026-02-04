# 🧪 Automation Test - Quick Start

## 📋 Что это?

Простой тест автоматизации для DolfPower, который:
1. Запускает профиль браузера
2. Открывает mixas.pro
3. Кликает на ссылку Medium
4. Скроллит 10 секунд
5. Закрывает профиль

## 🚀 Быстрый запуск

### Шаг 1: Установите зависимости

```bash
cd d:\Scripts\My\DolfPower
examples\install-deps.bat
```

Или вручную:
```bash
npm install puppeteer-core axios
```

### Шаг 2: Запустите сервер

В отдельном окне:
```bash
npm run dev:server
```

### Шаг 3: Запустите тест

```bash
examples\run-test.bat
```

Или вручную:
```bash
node examples\test-mixas.js
```

## 📝 Использование

### С первым доступным профилем:
```bash
node examples\test-mixas.js
```

### С конкретным профилем:
```bash
node examples\test-mixas.js YOUR_PROFILE_ID
```

## 📊 Пример вывода

```
🚀 Starting automation test...
📋 Profile ID: abc123...

1️⃣ Starting profile...
✅ Profile started

2️⃣ Connecting to browser...
✅ Connected to browser

3️⃣ Navigating to mixas.pro...
✅ Page loaded

4️⃣ Looking for Medium link...
✅ Medium link clicked

5️⃣ Scrolling for 10 seconds...
✅ Scrolling completed

6️⃣ Disconnecting...
✅ Disconnected from browser

7️⃣ Stopping profile...
✅ Profile stopped

🎉 Test completed successfully!
```

## 🔧 Кастомизация

### Изменить URL:
```javascript
await page.goto('https://your-site.com');
```

### Изменить время скролла:
```javascript
await randomScroll(page, 20000); // 20 секунд
```

### Добавить действия:
```javascript
// Ввести текст
await page.type('#search', 'hello');

// Кликнуть кнопку
await page.click('.submit-button');

// Скриншот
await page.screenshot({ path: 'screenshot.png' });
```

## ❓ Проблемы?

### "Server is not running"
Запустите сервер: `npm run dev:server`

### "Profile not found"
Создайте профиль через UI: http://127.0.0.1:3001/ui/index.html

### "Cannot find module"
Установите зависимости: `examples\install-deps.bat`

## 📚 Подробная документация

См. `README-test-mixas.md` для полной документации.
