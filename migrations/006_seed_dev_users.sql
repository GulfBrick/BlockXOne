-- Seed additional local demo users with password Admin123!
-- Hash generated with: bcrypt.GenerateFromPassword([]byte("Admin123!"), bcrypt.DefaultCost)

DO $$
DECLARE
  u_id UUID;
  r_id UUID;
BEGIN
  -- Investor
  SELECT id INTO u_id FROM users WHERE email = 'investor@blockxone.local';
  IF u_id IS NULL THEN
    INSERT INTO users (email, password_hash, status)
    VALUES ('investor@blockxone.local', '$2a$10$O1Z8ztnBVYpgX1N2LqYwLek1qT.oVdWPqaVJEXTmovX2BKMfIFik.', 'ACTIVE')
    RETURNING id INTO u_id;
  END IF;
  SELECT id INTO r_id FROM roles WHERE name = 'Investor';
  IF r_id IS NOT NULL THEN
    INSERT INTO user_org_roles (user_id, org_id, role_id)
    VALUES (u_id, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', r_id)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Compliance Officer
  SELECT id INTO u_id FROM users WHERE email = 'compliance@blockxone.local';
  IF u_id IS NULL THEN
    INSERT INTO users (email, password_hash, status)
    VALUES ('compliance@blockxone.local', '$2a$10$O1Z8ztnBVYpgX1N2LqYwLek1qT.oVdWPqaVJEXTmovX2BKMfIFik.', 'ACTIVE')
    RETURNING id INTO u_id;
  END IF;
  SELECT id INTO r_id FROM roles WHERE name = 'ComplianceOfficer';
  IF r_id IS NOT NULL THEN
    INSERT INTO user_org_roles (user_id, org_id, role_id)
    VALUES (u_id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', r_id)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Offering Manager
  SELECT id INTO u_id FROM users WHERE email = 'offering.manager@blockxone.local';
  IF u_id IS NULL THEN
    INSERT INTO users (email, password_hash, status)
    VALUES ('offering.manager@blockxone.local', '$2a$10$O1Z8ztnBVYpgX1N2LqYwLek1qT.oVdWPqaVJEXTmovX2BKMfIFik.', 'ACTIVE')
    RETURNING id INTO u_id;
  END IF;
  SELECT id INTO r_id FROM roles WHERE name = 'OfferingManager';
  IF r_id IS NOT NULL THEN
    INSERT INTO user_org_roles (user_id, org_id, role_id)
    VALUES (u_id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', r_id)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Issuer Fund Manager
  SELECT id INTO u_id FROM users WHERE email = 'issuer@blockxone.local';
  IF u_id IS NULL THEN
    INSERT INTO users (email, password_hash, status)
    VALUES ('issuer@blockxone.local', '$2a$10$O1Z8ztnBVYpgX1N2LqYwLek1qT.oVdWPqaVJEXTmovX2BKMfIFik.', 'ACTIVE')
    RETURNING id INTO u_id;
  END IF;
  SELECT id INTO r_id FROM roles WHERE name = 'IssuerFundManager';
  IF r_id IS NOT NULL THEN
    INSERT INTO user_org_roles (user_id, org_id, role_id)
    VALUES (u_id, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', r_id)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Tokenisation Agent
  SELECT id INTO u_id FROM users WHERE email = 'token.agent@blockxone.local';
  IF u_id IS NULL THEN
    INSERT INTO users (email, password_hash, status)
    VALUES ('token.agent@blockxone.local', '$2a$10$O1Z8ztnBVYpgX1N2LqYwLek1qT.oVdWPqaVJEXTmovX2BKMfIFik.', 'ACTIVE')
    RETURNING id INTO u_id;
  END IF;
  SELECT id INTO r_id FROM roles WHERE name = 'TokenisationAgent';
  IF r_id IS NOT NULL THEN
    INSERT INTO user_org_roles (user_id, org_id, role_id)
    VALUES (u_id, 'dddddddd-dddd-dddd-dddd-dddddddddddd', r_id)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Transfer Agent
  SELECT id INTO u_id FROM users WHERE email = 'transfer.agent@blockxone.local';
  IF u_id IS NULL THEN
    INSERT INTO users (email, password_hash, status)
    VALUES ('transfer.agent@blockxone.local', '$2a$10$O1Z8ztnBVYpgX1N2LqYwLek1qT.oVdWPqaVJEXTmovX2BKMfIFik.', 'ACTIVE')
    RETURNING id INTO u_id;
  END IF;
  SELECT id INTO r_id FROM roles WHERE name = 'TransferAgent';
  IF r_id IS NOT NULL THEN
    INSERT INTO user_org_roles (user_id, org_id, role_id)
    VALUES (u_id, 'cccccccc-cccc-cccc-cccc-cccccccccccc', r_id)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
