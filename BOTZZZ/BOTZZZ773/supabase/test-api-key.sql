-- Get a valid API key for testing
SELECT 
  ak.key,
  ak.key_prefix,
  ak.status as key_status,
  u.email,
  u.status as user_status,
  u.role
FROM api_keys ak
JOIN users u ON ak.user_id = u.id
WHERE ak.status = 'active'
  AND u.status = 'active'
ORDER BY ak.created_at DESC
LIMIT 1;
