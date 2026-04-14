# CodexCar

PWA-приложение для автовладельцев и СТО. CodexCar хранит цифровой сервисный паспорт машины: owner ID, историю обслуживания, карточки деталей с OEM, датой и пробегом установки, а также подтвержденные записи от механиков.

## Что уже есть

- интерфейс на `React + TypeScript + Vite`
- PWA-основа: `manifest`, `service worker`, установка на телефон и ПК
- локальное сохранение в `IndexedDB`
- роли `owner`, `mechanic`, `service_admin`, `company_admin`
- owner-first сценарий: паспорт авто, личные записи, регламент и сервисная история
- карточки деталей с `OEM`, источником установки, датой, пробегом и следующим рубежом замены
- подтвержденные сервисные записи от СТО
- облачный слой на `Supabase Auth + Postgres`

## Запуск

```bash
npm install
npm run dev
```

Для включения облака создайте `.env` по примеру `.env.example`.
Для production используйте переменные из `.env.production.example`.

```bash
npm run build
```

## Cloud / Supabase

- клиент и auth: `src/lib/supabase.ts`, `src/lib/cloud.ts`
- базовая схема: `supabase/schema.sql`
- bootstrap owner/mechanic: `supabase/phase2_bootstrap.sql`
- роли СТО и очередь: `supabase/phase4_service_roles.sql`
- staff bootstrap и сохранение профиля: `supabase/phase6_staff_bootstrap.sql`, `supabase/phase7_profile_save.sql`
- запись деталей и сервисных работ: `supabase/phase11_cloud_writes.sql`
- метаданные установки детали: `supabase/phase14_part_installation_meta.sql`

## Идея продукта

- владелец сразу видит, когда менялось масло, тормоза, фильтры и ГРМ
- каждая деталь хранит `OEM`, производителя, комментарии и план следующей замены
- механик открывает машину по owner ID и добавляет подтвержденные записи в историю
- сервисная история помогает при продаже автомобиля и повышает доверие к машине
