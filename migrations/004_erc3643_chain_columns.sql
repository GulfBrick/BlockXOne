-- 004_erc3643_chain_columns.sql
-- Adds ERC-3643 deployment addresses to offerings table.
-- The old code stored compliance_registry inside rules_json;
-- proper columns are safer and queryable.

ALTER TABLE offerings
  ADD COLUMN IF NOT EXISTS identity_registry text,
  ADD COLUMN IF NOT EXISTS compliance_contract text;

-- Migrate any existing rules_json compliance_registry values
UPDATE offerings
SET compliance_contract = rules_json->>'compliance_registry'
WHERE compliance_contract IS NULL
  AND rules_json->>'compliance_registry' IS NOT NULL
  AND rules_json->>'compliance_registry' != '';
