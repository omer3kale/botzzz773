-- Create settings table to store site configuration (SMTP, notifications, integrations)
create table if not exists public.settings (
  key text primary key,
  value jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Trigger for updated_at
do $$
begin
  if not exists (
    select 1 from pg_proc where proname = 'settings_set_updated_at'
  ) then
    create or replace function public.settings_set_updated_at()
    returns trigger as $$
    begin
      new.updated_at := now();
      return new;
    end;
    $$ language plpgsql;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'settings_updated_at_trigger'
  ) then
    create trigger settings_updated_at_trigger
    before update on public.settings
    for each row
    execute function public.settings_set_updated_at();
  end if;
end $$;

-- Index for key lookups
create index if not exists idx_settings_key on public.settings (key);

-- Add alert_on_low_balance column to providers table if not exists
alter table if exists public.providers add column if not exists alert_on_low_balance boolean default true;
