-- 008_chain_operations_log.sql
-- Dedicated chain operations log for all on-chain activity.
-- Provides a queryable, indexed view separate from the general audit_log.
-- This table is append-only and supports regulatory reporting.

CREATE TABLE IF NOT EXISTS chain_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL REFERENCES offerings(id),
  operation text NOT NULL,           -- PAUSE, UNPAUSE, MINT, BURN, FREEZE, UNFREEZE,
                                     -- FORCE_TRANSFER, RECOVER_TOKENS, DEPLOY_ERC3643,
                                     -- IDENTITY_REGISTER, IDENTITY_DELETE,
                                     -- COMPLIANCE_MODULE_ADD, COMPLIANCE_MODULE_REMOVE
  tx_hash text,                      -- on-chain transaction hash (null for read-only checks)
  actor_user_id uuid,                -- who initiated it
  target_address text,               -- affected address (investor, module, lost wallet, etc.)
  secondary_address text,            -- second address (recovery address, to-address, etc.)
  amount text,                       -- token amount if applicable
  metadata jsonb DEFAULT '{}',       -- additional context (country code, module address, etc.)
  status text NOT NULL DEFAULT 'CONFIRMED', -- CONFIRMED, PENDING, FAILED
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chain_ops_offering ON chain_operations(offering_id);
CREATE INDEX IF NOT EXISTS idx_chain_ops_operation ON chain_operations(operation);
CREATE INDEX IF NOT EXISTS idx_chain_ops_tx ON chain_operations(tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chain_ops_actor ON chain_operations(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_chain_ops_created ON chain_operations(created_at);
CREATE INDEX IF NOT EXISTS idx_chain_ops_target ON chain_operations(target_address) WHERE target_address IS NOT NULL;
