# 🔧 Как дать мне доступ к управлению Apps Script

## Проблема
Токен авторизован с твоего аккаунта, но я не могу им управлять без refresh_token.

## Решение 1: Получить refresh_token (быстро)

1. Открой в браузере (твой аккаунт!):
```
https://accounts.google.com/o/oauth2/auth?response_type=code&client_id=864225289733-sgk5u8euf6tp4bg1f90lkaqihsgqtg45.apps.googleusercontent.com&redirect_uri=http://localhost:8080&scope=https://www.googleapis.com/auth/drive+https://www.googleapis.com/auth/spreadsheets+https://www.googleapis.com/auth/documents+https://www.googleapis.com/auth/script.projects+https://www.googleapis.com/auth/script.deployments+https://www.googleapis.com/auth/script.metrics+https://www.googleapis.com/auth/calendar+https://www.googleapis.com/auth/gmail.readonly+https://www.googleapis.com/auth/gmail.send+https://www.googleapis.com/auth/gmail.modify&access_type=offline&prompt=consent
```

2. После авторизации скопируй код из URL (после `code=`)

3. Пришли мне код — я обновлю токен

## Решение 2: Дать доступ через UI (2 минуты)

1. Открой созданный проект: https://script.google.com/d/1Nan5GqIv2eY4tC-wmdrOQaxkEGL_9vbISnSfCN1c4vcwnXGUfVRrm6Qo/edit

2. Нажми **Share** (верхний правый угол)

3. В поле ввода добавь: `frutskoi@gmail.com`

4. Выбери **Editor**

5. Нажми **Send**

После этого я смогу редактировать скрипт!

---

Какой вариант? 👹