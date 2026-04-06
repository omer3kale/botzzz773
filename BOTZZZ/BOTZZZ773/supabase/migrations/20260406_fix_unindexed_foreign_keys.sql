-- Fix Supabase performance advisor warnings for unindexed foreign keys

BEGIN;

CREATE INDEX IF NOT EXISTS idx_link_management_primary_service_id
    ON public.link_management(primary_service_id);

CREATE INDEX IF NOT EXISTS idx_provider_errors_resolved_by
    ON public.provider_errors(resolved_by);

CREATE INDEX IF NOT EXISTS idx_services_admin_approved_by
    ON public.services(admin_approved_by);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_id
    ON public.ticket_messages(ticket_id);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_user_id
    ON public.ticket_messages(user_id);

CREATE INDEX IF NOT EXISTS idx_tickets_order_id
    ON public.tickets(order_id);

COMMIT;
