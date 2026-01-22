
-- 001_init.sql
-- BlockXOne core schema

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ENUMS
DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('ACTIVE','DISABLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE org_type AS ENUM ('PLATFORM','ISSUER','AGENT','INVESTOR_ORG');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE kyc_type AS ENUM ('KYC','KYB');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE kyc_status AS ENUM ('DRAFT','SUBMITTED','APPROVED','REJECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE wallet_status AS ENUM ('PENDING','APPROVED','REJECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE offering_status AS ENUM ('DRAFT','LIVE','CLOSED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE subscription_status AS ENUM ('REQUESTED','APPROVED','REJECTED','PAID','MINTED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('PENDING','RECEIVED','FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE whitelist_status AS ENUM ('REQUESTED','EXECUTING','CONFIRMED','FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE token_batch_type AS ENUM ('MINT','BURN','FREEZE','UNFREEZE','FORCE_TRANSFER','WHITELIST');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE token_batch_status AS ENUM ('CREATED','EXECUTING','CONFIRMED','FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE chain_tx_status AS ENUM ('PENDING','SENT','CONFIRMED','FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE distribution_status AS ENUM ('CREATED','PAYOUTS_PENDING','COMPLETED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE distribution_item_status AS ENUM ('PENDING','SENT','FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE redemption_status AS ENUM ('REQUESTED','APPROVED','REJECTED','BURN_CONFIRMED','PAYOUT_SENT','COMPLETED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE payout_status AS ENUM ('PENDING','SENT','FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE listing_status AS ENUM ('OPEN','CANCELLED','FILLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE rfq_status AS ENUM ('OPEN','CANCELLED','MATCHED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE trade_status AS ENUM ('PENDING_SETTLEMENT','SETTLED','FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE outbox_status AS ENUM ('NEW','PUBLISHED','FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- IDENTITY
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  phone text,
  status user_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orgs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type org_type NOT NULL DEFAULT 'PLATFORM',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY(role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_org_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY(user_id, org_id, role_id)
);

-- COMPLIANCE
CREATE TABLE IF NOT EXISTS kyc_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type kyc_type NOT NULL,
  status kyc_status NOT NULL DEFAULT 'DRAFT',
  vendor_ref text,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kyc_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES kyc_cases(id) ON DELETE CASCADE,
  file_key text NOT NULL,
  doc_type text NOT NULL,
  status text NOT NULL DEFAULT 'STORED',
  checksum_sha256 text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS screening_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES kyc_cases(id) ON DELETE CASCADE,
  pep boolean NOT NULL DEFAULT false,
  sanctions boolean NOT NULL DEFAULT false,
  matches integer NOT NULL DEFAULT 0,
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS investor_profile (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  investor_status text,
  accredited_flag boolean NOT NULL DEFAULT false,
  qualified_flag boolean NOT NULL DEFAULT false,
  jurisdiction text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address text NOT NULL,
  chain_id integer NOT NULL,
  status wallet_status NOT NULL DEFAULT 'PENDING',
  signed_message text,
  message text,
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, address, chain_id)
);

-- OFFERINGS / ASSETS
CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type text NOT NULL,
  name text NOT NULL,
  description text,
  legal_entity_id text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS offerings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  status offering_status NOT NULL DEFAULT 'DRAFT',
  price numeric(20,8),
  currency text,
  min numeric(20,8),
  max numeric(20,8),
  start_at timestamptz,
  end_at timestamptz,
  chain_id integer,
  token_contract text,
  rules_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS offering_agents (
  offering_id uuid PRIMARY KEY REFERENCES offerings(id) ON DELETE CASCADE,
  transfer_agent_org_id uuid REFERENCES orgs(id),
  tokenisation_agent_org_id uuid REFERENCES orgs(id),
  offering_manager_user_id uuid REFERENCES users(id)
);

-- SUBSCRIPTIONS / PAYMENTS
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  units numeric(20,8) NOT NULL,
  amount numeric(20,8) NOT NULL,
  status subscription_status NOT NULL DEFAULT 'REQUESTED',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(offering_id, user_id)
);

CREATE TABLE IF NOT EXISTS payment_instructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  method text NOT NULL,
  bank_ref text,
  wallet_address text,
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  method text NOT NULL,
  amount numeric(20,8) NOT NULL,
  received_at timestamptz,
  reference text,
  status payment_status NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reconciliation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  matched_by uuid REFERENCES users(id),
  matched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- TOKEN OPS / ON-CHAIN
CREATE TABLE IF NOT EXISTS whitelist_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  wallet_id uuid NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  status whitelist_status NOT NULL DEFAULT 'REQUESTED',
  requested_by uuid REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(offering_id, wallet_id)
);

CREATE TABLE IF NOT EXISTS token_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  type token_batch_type NOT NULL,
  status token_batch_status NOT NULL DEFAULT 'CREATED',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS token_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES token_batches(id) ON DELETE CASCADE,
  wallet_id uuid REFERENCES wallets(id),
  amount numeric(20,8),
  to_wallet_id uuid REFERENCES wallets(id),
  status token_batch_status NOT NULL DEFAULT 'CREATED',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chain_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_item_id uuid REFERENCES token_batch_items(id) ON DELETE CASCADE,
  chain_id integer,
  tx_hash text,
  status chain_tx_status NOT NULL DEFAULT 'PENDING',
  confirmations integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- LEDGER / CAP TABLE
CREATE TABLE IF NOT EXISTS holdings (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offering_id uuid NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  wallet_id uuid NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  balance numeric(30,8) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, offering_id, wallet_id)
);

CREATE TABLE IF NOT EXISTS cap_table_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  record_date date NOT NULL,
  total_supply numeric(30,8) NOT NULL DEFAULT 0,
  snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(offering_id, record_date)
);

CREATE TABLE IF NOT EXISTS transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  from_wallet text,
  to_wallet text,
  amount numeric(30,8) NOT NULL,
  tx_hash text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

-- CORPORATE ACTIONS
CREATE TABLE IF NOT EXISTS distributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  record_date date NOT NULL,
  total_amount numeric(30,8) NOT NULL,
  status distribution_status NOT NULL DEFAULT 'CREATED',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS distribution_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_id uuid NOT NULL REFERENCES distributions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount numeric(30,8) NOT NULL,
  status distribution_item_status NOT NULL DEFAULT 'PENDING',
  payout_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_tokens numeric(30,8) NOT NULL,
  amount_cash numeric(30,8),
  status redemption_status NOT NULL DEFAULT 'REQUESTED',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method text NOT NULL DEFAULT 'OFFCHAIN',
  amount numeric(30,8) NOT NULL,
  status payout_status NOT NULL DEFAULT 'PENDING',
  reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- MARKETPLACE (RFQ v1)
CREATE TABLE IF NOT EXISTS marketplace_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  seller_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_wallet_id uuid NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  units numeric(30,8) NOT NULL,
  price numeric(30,8) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  status listing_status NOT NULL DEFAULT 'OPEN',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marketplace_rfqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  buyer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  buyer_wallet_id uuid NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  units numeric(30,8) NOT NULL,
  max_price numeric(30,8) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  status rfq_status NOT NULL DEFAULT 'OPEN',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marketplace_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  rfq_id uuid NOT NULL REFERENCES marketplace_rfqs(id) ON DELETE CASCADE,
  seller_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  buyer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_wallet text NOT NULL,
  buyer_wallet text NOT NULL,
  units numeric(30,8) NOT NULL,
  price numeric(30,8) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  status trade_status NOT NULL DEFAULT 'PENDING_SETTLEMENT',
  settlement_tx_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- AUDIT
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before_json jsonb,
  after_json jsonb,
  ip inet,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS policy_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offering_id uuid REFERENCES offerings(id) ON DELETE CASCADE,
  decision text NOT NULL,
  policy_version text NOT NULL DEFAULT 'v1',
  reasons_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- OUTBOX EVENTS
CREATE TABLE IF NOT EXISTS outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status outbox_status NOT NULL DEFAULT 'NEW',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_kyc_cases_user ON kyc_cases(user_id);
CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_offerings_status ON offerings(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_offering ON subscriptions(offering_id);
CREATE INDEX IF NOT EXISTS idx_holdings_offering ON holdings(offering_id);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox_events(status);
