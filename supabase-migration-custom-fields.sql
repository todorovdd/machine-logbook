-- Миграция: добавя възможност за персонализирани полета към записите за
-- обслужване. Изпълни това в Supabase → SQL Editor → New query → Run
-- (безопасно е, не трие нищо съществуващо).

create table if not exists field_definitions (
  id bigint generated always as identity primary key,
  key text unique not null,
  label text not null,
  field_type text not null default 'text', -- text | textarea | number | date | select
  options jsonb,
  required boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

alter table service_records add column if not exists custom_fields jsonb not null default '{}'::jsonb;

create index if not exists idx_field_definitions_order on field_definitions(sort_order);

alter table field_definitions enable row level security;
