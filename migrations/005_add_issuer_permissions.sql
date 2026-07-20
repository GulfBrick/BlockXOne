-- Grant additional permissions to IssuerFundManager for functional issuer portal

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name='IssuerFundManager'
  AND p.key IN (
    'offering:create',
    'offering:edit',
    'offering:publish',
    'subscription:approve'
  )
ON CONFLICT DO NOTHING;
