# Puter API Skill

## 📋 Общая информация
**Официальная документация:** https://docs.puter.com
**NPM пакет:** @heyputer/puter.js
**Режим работы:** Ключевой, без необходимости API ключей (автоматическая авторизация)

**Последнее обновление:** 2026-05-27
**Статус:** ✅ Настроен и протестирован

## 🔑 Аутентификация

### Автоматическая авторизация (Браузер)
Puter.js использует автоматическую авторизацию через popup окно:

```html
<script src="https://js.puter.com/v2/"></script>
<script>
  await puter.auth.signIn().then((res) => {
    console.log('Signed in', res);
  });
</script>
```

### Авторизация через токен (Node.js)
Для Node.js используется токен авторизации:

```javascript
const {init} = require('@heyputer/puter.js/src/init.cjs');
const puter = init('YOUR_AUTH_TOKEN');
```

**Текущий токен:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0eXBlIjoiZ3VpIiwidmVyc2lvbiI6IjAuMC4wIiwidXVpZCI6ImE5MTY0MDZlLTA0YWQtNDljYy1hYTk5LThiNWEwNzQyZWM2NiIsInVzZXJfdWlkIjoiZGFjYmRkMjgtMzgwNC00MzM4LTkyYTktOTMxZTYwZTJiMWM4IiwiaWF0IjoxNzc3MDE2MjQ0fQ.qCvOVjmsTbyvnXE0ThDTkdhacC1cmD578QIVBAsqrwQ`

**Важно:** Puter.js работает в браузере (frontend) и не требует backend сервера!

## 📡 Основные API методы

### 1. Файловая система (File System)

#### Создание файла
```javascript
puter.fs.write('hello.txt', 'Hello, world!').then((file) => {
  puter.print(`File created: ${file.path}`);
});
```

#### Чтение файла
```javascript
const blob = await puter.fs.read('hello.txt');
const content = await blob.text();
console.log(content);
```

#### Создание директории
```javascript
await puter.fs.mkdir('my-folder');
```

#### Удаление файла
```javascript
await puter.fs.delete('hello.txt');
```

#### Перечисление файлов
```javascript
const files = await puter.fs.readdir('/');
console.log(files);
```

### 2. AI Чат (GPT, Claude, Gemini)

#### Чат с GPT-5.4 nano (по умолчанию)
```javascript
puter.ai.chat('What is life?').then(puter.print);
```

#### Выбор модели
```javascript
puter.ai.chat('What is life?', { model: 'gpt-5.4-nano' }).then(puter.print);
```

#### Анализ изображений
```javascript
puter.ai.chat('What do you see?', 'https://example.com/image.jpg', {
  model: 'gpt-5.4-nano'
}).then(puter.print);
```

#### Генерация изображений
```javascript
// testMode=true для тестирования без затрат кредитов
puter.ai.txt2img('A picture of a cat.', true).then((image) => {
  document.body.appendChild(image);
});
```

#### Потоковый ответ
```javascript
const resp = await puter.ai.chat('Tell me about Rick and Morty', {
  model: 'gemini-2.5-flash-lite',
  stream: true
});

for await (const part of resp) {
  puter.print(part?.text);
}
```

### 3. Хранилище ключей (Key-Value Store)

#### Сохранение значения
```javascript
puter.kv.set('userPreference', 'darkMode').then(() => {
  console.log('Saved!');
});
```

#### Получение значения
```javascript
puter.kv.get('userPreference').then(value => {
  console.log(value); // 'darkMode'
});
```

#### Удаление значения
```javascript
puter.kv.delete('userPreference');
```

### 4. Хостинг статических сайтов

#### Создание сайта
```javascript
// 1. Создать директорию
const dirName = puter.randName();
await puter.fs.mkdir(dirName);

// 2. Создать index.html
await puter.fs.write(`${dirName}/index.html`, '<h1>Hello, world!</h1>');

// 3. Опубликовать
const subdomain = puter.randName();
const site = await puter.hosting.create(subdomain, dirName);

console.log(`Site: https://${site.subdomain}.puter.site`);
```

### 5. Сеть без CORS ограничений

#### GET запрос без CORS
```javascript
const request = await puter.net.fetch("https://example.com");
const body = await request.text();
console.log(body);
```

#### POST запрос без CORS
```javascript
const request = await puter.net.fetch("https://api.example.com/data", {
  method: 'POST',
  body: JSON.stringify({key: 'value'}),
  headers: {'Content-Type': 'application/json'}
});
```

### 6. Вывод в консоль Puter

#### Вывод текста
```javascript
puter.print('Hello from Puter!');
```

#### Вывод кода
```javascript
puter.print('<h1>Code</h1>', {code: true});
```

## 🔧 Примеры для Google Apps Script

Puter.js не работает в Google Apps Script (только браузер!). Для работы с облачным хранилищем в Google Apps Script используйте:

### Google Drive API (аналог Puter FS)
```javascript
function writeToDrive(filename, content) {
  var folders = DriveApp.getFoldersByName('MyFolder');
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder('MyFolder');
  var file = folder.createFile(filename, content, MimeType.PLAIN_TEXT);
  console.log('File created: ' + file.getUrl());
}

function readFromDrive(filename) {
  var folders = DriveApp.getFoldersByName('MyFolder');
  if (folders.hasNext()) {
    var folder = folders.next();
    var files = folder.getFilesByName(filename);
    if (files.hasNext()) {
      return files.next().getBlob().getDataAsString();
    }
  }
  return null;
}
```

### Google Cloud Storage (если нужно)
```javascript
// Для работы с Google Cloud Storage нужен Service Account
// Пример через URLFetchApp:
function writeToGCS(filename, content) {
  var bucket = 'my-bucket';
  var url = `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${filename}`;

  var options = {
    method: 'POST',
    contentType: 'text/plain',
    payload: content,
    headers: {
      'Authorization': 'Bearer YOUR_GCS_TOKEN'
    },
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  return response.getResponseCode() === 200;
}
```

## 🚀 Быстрый старт (Браузер)

### Простой HTML файл
```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://js.puter.com/v2/"></script>
</head>
<body>
  <button onclick="signIn()">Sign In</button>
  <button onclick="saveFile()">Save File</button>
  <button onclick="chatAI()">Chat with AI</button>

  <script>
    async function signIn() {
      await puter.auth.signIn().then((res) => {
        console.log('Signed in', res);
      });
    }

    async function saveFile() {
      await puter.fs.write('test.txt', 'Hello from Puter!')
        .then(() => alert('Saved!'));
    }

    async function chatAI() {
      const response = await puter.ai.chat('Say hello!');
      alert(response);
    }
  </script>
</body>
</html>
```

## 🔄 Ограничения

- **Клиентская библиотека:** Работает только в браузере, не в Node.js/Apps Script
- **API ограничения:** Зависят от бесплатного тарифа
- **Модели AI:** GPT-5.4 nano, Claude, Gemini (ограничены кредитами)
- **Хранение:** Бесплатное хранилище с ограничениями

## 📊 Доступные AI модели

- **GPT-5.4 nano** (по умолчанию)
- **Claude 3.5 Sonnet**
- **Gemini 2.5 Flash Lite**

## 🔒 Безопасность

- ✅ Без API ключей (автоматическая авторизация)
- ✅ Приватность (без трекинга)
- ✅ Бесплатно для пользователей
- ✅ Open Source

## 📅 История изменений

### 2026-05-27
- ✅ Установлен @heyputer/puter.js
- ✅ Создан skill
- ✅ Настроен токен авторизации
- ✅ Создан Python CLI обёртка
- ⚠️ Проверено: работает только в браузере, не в Node.js

## 🎯 Использование в OpenClaw

Puter.js подходит для:
- Создания веб-приложений с облачным хранилищем
- AI чата без API ключей
- Хостинга статических сайтов
- CORS-free сетевых запросов

**НЕ подходит для:**
- Google Apps Script (используйте Google Drive API)
- Backend серверов (используйте обычное облако)
- CLI утилит (это клиентская библиотека)