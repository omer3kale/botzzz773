-- Manually sync order 37071867 to completed status
UPDATE orders
SET 
  status = 'completed',
  customer_status = 'completed',
  provider_status = 'completed',
  last_status_sync = NOW()
WHERE order_number = '37071867';

-- Verify the update
SELECT 
  order_number,
  status,
  customer_status,
  provider_status,
  last_status_sync
FROM orders
WHERE order_number = '37071867';
