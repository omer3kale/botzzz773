-- Add strategy_applied column to price_change_logs
-- Tracks which markup strategy was applied during price sync

alter table public.price_change_logs 
add column if not exists strategy_applied text;

comment on column public.price_change_logs.strategy_applied is 'The markup strategy applied: provider_increase_markup_fixed, provider_decrease_retail_fixed, no_change, retail_manual_adjustment, provider_change_no_retail_adjustment';
