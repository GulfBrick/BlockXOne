-- 007_erc3643_permissions.sql
-- Add ERC-3643 specific permissions and assign to roles.

INSERT INTO permissions(key) VALUES
  ('tokenops:pause'),
  ('tokenops:unpause'),
  ('tokenops:recover'),
  ('tokenops:identity_register'),
  ('tokenops:identity_delete'),
  ('tokenops:compliance_module'),
  ('tokenops:deploy_erc3643')
ON CONFLICT (key) DO NOTHING;

-- Transfer Agent gets pause/unpause/recover/identity operations
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name='TransferAgent' AND p.key IN (
  'tokenops:pause',
  'tokenops:unpause',
  'tokenops:recover',
  'tokenops:identity_register',
  'tokenops:identity_delete'
)
ON CONFLICT DO NOTHING;

-- Tokenisation Agent gets ERC-3643 deploy + compliance module management
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name='TokenisationAgent' AND p.key IN (
  'tokenops:deploy_erc3643',
  'tokenops:compliance_module',
  'tokenops:identity_register',
  'tokenops:identity_delete'
)
ON CONFLICT DO NOTHING;

-- Compliance Officer gets compliance module management
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name='ComplianceOfficer' AND p.key IN (
  'tokenops:compliance_module'
)
ON CONFLICT DO NOTHING;

-- Issuer/Fund Manager gets pause/unpause (emergency controls)
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name='IssuerFundManager' AND p.key IN (
  'tokenops:pause',
  'tokenops:unpause'
)
ON CONFLICT DO NOTHING;

-- SuperAdmin gets everything (already has wildcard but explicit is safer)
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name='SuperAdmin' AND p.key IN (
  'tokenops:pause',
  'tokenops:unpause',
  'tokenops:recover',
  'tokenops:identity_register',
  'tokenops:identity_delete',
  'tokenops:compliance_module',
  'tokenops:deploy_erc3643'
)
ON CONFLICT DO NOTHING;
