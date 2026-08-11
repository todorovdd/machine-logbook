-- Миграция v2: персонализирани полета (за машина и за обслужване) +
-- предварително попълнени полета за мониторинг на охлаждаща течност.
-- Безопасно е да се изпълни дори ако вече си пускал по-стар миграционен
-- файл — всичко е с "if not exists" / "on conflict do nothing".
--
-- Изпълни в Supabase → SQL Editor → New query → Run.

create table if not exists field_definitions (
  id bigint generated always as identity primary key,
  key text unique not null,
  label text not null,
  field_type text not null default 'text',
  options jsonb,
  required boolean not null default false,
  scope text not null default 'record',
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

alter table field_definitions add column if not exists scope text not null default 'record';
alter table service_records add column if not exists custom_fields jsonb not null default '{}'::jsonb;
alter table machines add column if not exists custom_fields jsonb not null default '{}'::jsonb;

create index if not exists idx_field_definitions_order on field_definitions(scope, sort_order);

alter table field_definitions enable row level security;

-- Полета за самата машина (попълват се веднъж, при създаване/редакция)
insert into field_definitions (key, label, field_type, scope, sort_order, required)
values
  ('product', 'Продукт', 'text', 'machine', 0, false),
  ('tank_volume', 'Обем на резервоара', 'text', 'machine', 1, false),
  ('recommended_concentration', 'Препоръчителна концентрация', 'text', 'machine', 2, false),
  ('refractometer_coefficient', 'Коефициент на рефрактометър', 'text', 'machine', 3, false),
  ('fill_date', 'Дата на зареждане', 'date', 'machine', 4, false)
on conflict (key) do nothing;

-- Полета за всеки отделен преглед/обслужване
insert into field_definitions (key, label, field_type, scope, sort_order, required)
values
  ('concentration_percent', 'Концентрация (%)', 'number', 'record', 0, false),
  ('ph_level', 'pH (норма 8.7 - 9.2)', 'number', 'record', 1, false),
  ('appearance', 'Външен вид, цвят, мирис', 'text', 'record', 2, false)
on conflict (key) do nothing;
