-- Схема за Дигитален дневник (Supabase / Postgres)
-- Изпълни целия този файл в Supabase → SQL Editor → New query → Run

create table if not exists users (
  id bigint generated always as identity primary key,
  username text unique not null,
  password_hash text not null,
  created_at timestamptz default now()
);

create table if not exists factories (
  id bigint generated always as identity primary key,
  name text not null,
  location text,
  created_at timestamptz default now()
);

create table if not exists machines (
  id bigint generated always as identity primary key,
  factory_id bigint not null references factories(id) on delete cascade,
  name text not null,
  model text,
  serial_number text,
  slug text unique not null,
  created_at timestamptz default now()
);

create table if not exists service_records (
  id bigint generated always as identity primary key,
  machine_id bigint not null references machines(id) on delete cascade,
  service_date date not null,
  work_done text not null,
  notes text,
  technician text,
  created_at timestamptz default now()
);

create index if not exists idx_machines_factory on machines(factory_id);
create index if not exists idx_records_machine on service_records(machine_id);

-- Забележка за сигурност: тези таблици се четат/пишат само от сървърната
-- функция (с service_role ключа), а не директно от браузъра, затова тук
-- НЕ включваме Row Level Security policies — service_role заобикаля RLS.
-- Не публикувай service_role ключа никъде в клиентски (браузърен) код.
