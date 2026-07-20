-- 003_add_admin_permissions.sql
-- Add admin user management permissions

INSERT INTO permissions(key) VALUES
  ('admin:users:view'),
  ('admin:users:create'),
  ('admin:users:delete'),
  ('admin:stats:view')
ON CONFLICT (key) DO NOTHING;

-- Grant to SuperAdmin
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name='SuperAdmin' AND p.key IN (
  'admin:users:view',
  'admin:users:create',
  'admin:users:delete',
  'admin:stats:view'
)
ON CONFLICT DO NOTHING;
