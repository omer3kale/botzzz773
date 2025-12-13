-- Log price changes detected during provider sync
-- Creates price_change_logs table

create table if not exists public.price_change_logs (
    id bigserial primary key,
    service_id bigint not null references public.services(id) on delete cascade,
    provider_id uuid not null references public.providers(id) on delete cascade,
    provider_service_id text,
    old_provider_rate numeric(10,4),
    new_provider_rate numeric(10,4),
    old_retail_rate numeric(10,4),
    new_retail_rate numeric(10,4),
    markup_used numeric(6,2),
    detected_at timestamptz not null default now()
);

create index if not exists price_change_logs_service_id_idx on public.price_change_logs(service_id);
create index if not exists price_change_logs_provider_id_idx on public.price_change_logs(provider_id);
create index if not exists price_change_logs_detected_at_idx on public.price_change_logs(detected_at);

comment on table public.price_change_logs is 'Tracks provider/retail rate changes per service during sync';
