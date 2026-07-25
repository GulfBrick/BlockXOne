-- Bootstrap the local demo organizations and super admin.
-- Password: Admin123!
-- Hash generated with: bcrypt.GenerateFromPassword([]byte("Admin123!"), bcrypt.DefaultCost)

-- These organizations must exist before this migration assigns the admin role
-- and before 006_seed_dev_users.sql assigns the remaining demo roles.
INSERT INTO orgs (id, name, type) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'BlockXOne Platform', 'PLATFORM'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Example Issuer Co', 'ISSUER'),
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Example Transfer Agent', 'AGENT'),
    ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Example Tokenisation Agent', 'AGENT'),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Example Investor Org', 'INVESTOR_ORG')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    type = EXCLUDED.type;

DO $$
DECLARE
    admin_user_id UUID;
    admin_role_id UUID;
BEGIN
    INSERT INTO users (id, email, password_hash, status)
    VALUES (
        '99999999-9999-9999-9999-999999999999',
        'admin@blockxone.local',
        '$2a$10$O1Z8ztnBVYpgX1N2LqYwLek1qT.oVdWPqaVJEXTmovX2BKMfIFik.',
        'ACTIVE'
    )
    ON CONFLICT (email) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        status = 'ACTIVE'
    RETURNING id INTO admin_user_id;

    SELECT id INTO admin_role_id FROM roles WHERE name = 'SuperAdmin';

    IF admin_role_id IS NOT NULL THEN
        INSERT INTO user_org_roles (user_id, org_id, role_id)
        VALUES (admin_user_id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', admin_role_id)
        ON CONFLICT DO NOTHING;
    END IF;

    RAISE NOTICE 'Super admin ready: admin@blockxone.local / Admin123!';
END $$;
