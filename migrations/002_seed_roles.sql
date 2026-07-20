
-- 002_seed_roles.sql
-- Roles + permissions for BlockXOne (MVP)

-- Permissions
INSERT INTO permissions(key) VALUES
  ('offering:create'),
  ('offering:edit'),
  ('offering:publish'),
  ('offering:view'),
  ('compliance:queue:view'),
  ('compliance:case:approve'),
  ('wallet:approve'),
  ('subscription:approve'),
  ('payment:notify'),
  ('tokenops:whitelist'),
  ('tokenops:mint'),
  ('tokenops:burn'),
  ('tokenops:freeze'),
  ('tokenops:force_transfer'),
  ('ledger:portfolio:view'),
  ('ledger:cap_table:view'),
  ('corpactions:distribution:create'),
  ('corpactions:redemption:approve'),
  ('corpactions:payout:execute'),
  ('marketplace:listing:create'),
  ('marketplace:rfq:create'),
  ('marketplace:match')
ON CONFLICT (key) DO NOTHING;

-- Roles
INSERT INTO roles(name) VALUES
  ('Investor'),
  ('OfferingManager'),
  ('ComplianceOfficer'),
  ('IssuerFundManager'),
  ('TransferAgent'),
  ('TokenisationAgent'),
  ('SuperAdmin')
ON CONFLICT (name) DO NOTHING;

-- Role mappings (MVP)
-- Investor
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name='Investor' AND p.key IN (
  'offering:view',
  'ledger:portfolio:view',
  'marketplace:listing:create',
  'marketplace:rfq:create'
)
ON CONFLICT DO NOTHING;

-- Offering Manager
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name='OfferingManager' AND p.key IN (
  'offering:create','offering:edit','offering:publish','offering:view'
)
ON CONFLICT DO NOTHING;

-- Compliance Officer
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name='ComplianceOfficer' AND p.key IN (
  'compliance:queue:view','compliance:case:approve','wallet:approve','offering:view'
)
ON CONFLICT DO NOTHING;

-- Issuer/Fund Manager
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name='IssuerFundManager' AND p.key IN (
  'corpactions:distribution:create',
  'corpactions:redemption:approve',
  'ledger:cap_table:view',
  'offering:view',
  'offering:create',
  'offering:edit',
  'offering:publish',
  'subscription:approve'
)
ON CONFLICT DO NOTHING;

-- Transfer Agent
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name='TransferAgent' AND p.key IN (
  'subscription:approve','tokenops:freeze','tokenops:force_transfer','ledger:cap_table:view','offering:view'
)
ON CONFLICT DO NOTHING;

-- Tokenisation Agent
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name='TokenisationAgent' AND p.key IN (
  'tokenops:whitelist','tokenops:mint','tokenops:burn','offering:view'
)
ON CONFLICT DO NOTHING;

-- Super Admin (all permissions)
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name='SuperAdmin'
ON CONFLICT DO NOTHING;
