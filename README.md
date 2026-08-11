# Дигитален дневник — Netlify + Supabase версия

Същото приложение като преди (админ панел + QR код на всяка машина + публична страница само за нея), но пренаписано да работи на Netlify (безплатен хостинг) с база данни в Supabase, вместо на постоянно работещ сървър.

## 1. Направи Supabase проект

1. Влез в supabase.com → New Project.
2. Име (напр. `machine-logbook`), задай парола за базата (запази я някъде) и избери регион по-близо до теб.
3. Изчакай ~2 минути да се създаде проектът.
4. Отвори **SQL Editor** → New query → постави съдържанието на `supabase-schema.sql` (в тази папка) → Run. Това създава таблиците.
5. Отиди в **Project Settings → API** и запиши две неща:
   - **Project URL** (нещо от типа `https://xxxx.supabase.co`)
   - **service_role key** (не anon/public ключа — service_role, вижда се под "Project API keys")

## 2. Настрой локално (за да си създадеш админ акаунта)

```
npm install
cp .env.example .env
```

Отвори `.env` и попълни `SUPABASE_URL` и `SUPABASE_SERVICE_KEY` от стъпка 1, плюс `SESSION_SECRET` (произволен низ).

Създай администраторския си акаунт (еднократно):

```
npm run setup-admin
```

Ще те попита за потребителско име и парола (или ги сложи предварително като `ADMIN_USERNAME` / `ADMIN_PASSWORD` в `.env`).

По желание — тествай локално без Netlify:
```
npm run start:local
```
Отваряш http://localhost:8888 и влизаш с новите данни.

## 3. Публикувай в Netlify

1. Качи този проект в GitHub хранилище (drag & drop на файловете през github.com, както преди).
2. В Netlify: Add new site → Import from Git → избери хранилището.
3. Build command: `npm install`, Publish directory: `public` (Netlify обикновено ги познава сам от `netlify.toml`, но провери).
4. Site settings → Environment variables → добави: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SESSION_SECRET`, `BASE_URL` (остави `BASE_URL` празно за момента).
5. Deploy site. Netlify ще ти даде адрес от типа `https://random-name-123.netlify.app` (по-късно може да си сложиш и собствен домейн от Domain settings).
6. Обнови `BASE_URL` в Environment variables с този адрес → Netlify ще редеплойне автоматично. Едва тогава QR кодовете ще сочат вярно.

## Защо е по-добро това за постоянна употреба

- Базата данни е в Supabase (истинска Postgres база), не на диска на хостинга — данните ти няма да изчезнат при redeploy, за разлика от безплатния план на Render.
- Netlify е безплатен за такъв обем трафик.

## Ежедневна употреба

Влизаш в `https://твоя-адрес.netlify.app`, създаваш заводи и машини, разпечатваш QR кодовете (от бутона в машината), залепваш ги. Мениджърите сканират и виждат само тази машина — без вход.

## Ако нещо не тръгне

Най-честите проблеми:
- **QR кодът сочи towards localhost** → `BASE_URL` в Netlify не е обновен след първия деплой.
- **"Липсват SUPABASE_URL / SUPABASE_SERVICE_KEY"** грешка → environment variables не са добавени в Netlify (Site settings → Environment variables), не само в локалния `.env`.
- **Вход не работи** → провери дали `npm run setup-admin` наистина е минал успешно (виж Supabase → Table Editor → users, трябва да има ред).

Кажи ми на коя стъпка засядаш, ако има грешка — пращай ми точния текст на грешката.
