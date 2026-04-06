# Deploy On Cloudflare Pages

`CodexCar` уже можно отдать тестерам как статический `React/Vite` frontend, потому что база, auth и основная облачная логика работают через `Supabase`.

## Что понадобится

- аккаунт `Cloudflare`
- проект в `GitHub` или локальная папка с проектом
- `Supabase URL`
- `Supabase anon key`
- в `Supabase` уже должны быть выполнены все миграции до `phase7`

## Самый простой путь

1. Загрузить проект в `GitHub`
2. В `Cloudflare Pages` создать новый проект из репозитория
3. Для сборки указать:
   - `Framework preset`: `Vite`
   - `Build command`: `npm run build`
   - `Build output directory`: `dist`
4. В `Environment Variables` добавить:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Запустить деплой

## Что обновить после появления домена

Допустим, `Cloudflare Pages` выдал адрес:

`https://codexcar-beta.pages.dev`

Тогда нужно обновить настройки:

### В Supabase

`Authentication -> URL Configuration`

- `Site URL`: `https://codexcar-beta.pages.dev`
- `Redirect URLs`:
  - `https://codexcar-beta.pages.dev/**`
  - `http://localhost:5173/**`

### В Google Cloud OAuth

`Authorized JavaScript origins`

- `https://codexcar-beta.pages.dev`
- `http://localhost:5173`

`Authorized redirect URIs`

- `https://vdbaluxrztluqikocrqh.supabase.co/auth/v1/callback`

## Почему работает как SPA

Для деплоя через `Cloudflare Pages + Wrangler` отдельный `_redirects` не нужен: SPA-fallback уже обрабатывается самим `Cloudflare` через `not_found_handling: "single-page-application"`.

## Если не хотите GitHub

Можно загрузить `dist` вручную после команды:

```bash
npm run build
```

Но для быстрых обновлений удобнее связка `GitHub + Cloudflare Pages`.
