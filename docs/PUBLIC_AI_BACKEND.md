# Public AI Backend for CodexCar

## Что это дает
- тестеры смогут использовать AI-команды вне вашего ПК и вне вашей локальной сети
- локальный `Ollama` останется у вас дома, но запросы к нему будут идти через публичный tunnel URL

## Архитектура
`Устройство тестера -> CodexCar PWA -> Public Tunnel URL -> local-ai/server.mjs -> Ollama`

## 1. Запустить локальный AI backend
В корне проекта:

```powershell
$env:AI_ALLOWED_ORIGINS='https://carai2.sasha20010483.workers.dev'
$env:AI_RATE_LIMIT_PER_MINUTE='40'
npm run ai:server
```

Если позже у приложения будет другой домен, добавьте его в `AI_ALLOWED_ORIGINS` через запятую.

Пример:

```powershell
$env:AI_ALLOWED_ORIGINS='https://carai2.sasha20010483.workers.dev,https://carai.example.com'
```

## 2. Открыть backend наружу

### Быстрый тестовый вариант
После установки `cloudflared`:

```powershell
npm run ai:tunnel:quick
```

Команда покажет публичный URL вида:

`https://random-name.trycloudflare.com`

Этот адрес можно вставить в раздел `Локальный ИИ` внутри приложения.

### Быстрый запуск в два окна
Если не хочется вручную поднимать backend и tunnel по отдельности:

```powershell
npm run ai:public
```

Скрипт сам:
- откроет окно с локальным AI backend
- откроет окно с `Cloudflare quick tunnel`
- оставит вам только скопировать публичный `trycloudflare.com` URL

## 3. Подключить URL в приложении

### Временный runtime-вариант
В owner-вкладке `Локальный ИИ` вставьте tunnel URL в поле backend URL и нажмите `Проверить URL`.

### Постоянный production-вариант
Добавьте в Cloudflare frontend-проекта переменную:

`VITE_AI_BACKEND_URL=https://your-public-ai-backend.example.com`

После этого сделайте `Redeploy`.

## 4. Ограничения
- если ваш ПК выключен, AI тоже выключен
- quick tunnel дает временный URL, он меняется
- для стабильного публичного AI лучше потом сделать named tunnel и свой поддомен

## 5. Безопасность
- backend ограничивает origin через `AI_ALLOWED_ORIGINS`
- включен простой rate limit по IP
- AI не пишет в БД напрямую: сначала нормализация команды, затем валидация, затем действие приложения
