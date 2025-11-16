# Admin UI Refresh Summary

## Dashboard

- Recent Orders now surfaces each provider order ID directly under the local reference.
- Missing provider references render a "Provider order pending" label so support can spot sync gaps immediately.

## User Dashboard

- The customer-facing orders table mirrors the same provider order ID + pending-state cues beneath each reference.
- Links are sanitized and statuses normalized so the styling remains consistent across filters.

## Admin Section Cleanup

- Removed the Inter Miami style quick action cards from Users, Services, Payments, Tickets, and Settings to keep the focus on the core data tables and forms.
- Added a reusable `.no-quick-actions` layout modifier so these pages fill the full-width grid without the old side column.

## Next Watches

- If any future page re-introduces a quick action rail, remove the `no-quick-actions` class to restore the two-column grid.
- Consider porting the provider ID markup into other order-related cards for consistency.
