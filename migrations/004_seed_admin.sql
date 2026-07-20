-- Add super admin with password
-- Password: Admin123!
-- Hash generated with: bcrypt.GenerateFromPassword([]byte("Admin123!"), bcrypt.DefaultCost)

DO $$
DECLARE
    admin_user_id UUID;
    admin_role_id UUID;
BEGIN
    -- Check if admin user exists
    SELECT id INTO admin_user_id FROM users WHERE email = 'admin@blockxone.local';
    
    IF admin_user_id IS NULL THEN
        -- Create admin user
        INSERT INTO users (email, password_hash, status)
        VALUES (
            'admin@blockxone.local',
            '$2a$10$O1Z8ztnBVYpgX1N2LqYwLek1qT.oVdWPqaVJEXTmovX2BKMfIFik.',
            'ACTIVE'
        )
        RETURNING id INTO admin_user_id;
        
        -- Get SuperAdmin role ID
        SELECT id INTO admin_role_id FROM roles WHERE name = 'SuperAdmin';
        
        -- Assign SuperAdmin role
        IF admin_role_id IS NOT NULL THEN
            INSERT INTO user_org_roles (user_id, org_id, role_id)
            VALUES (admin_user_id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', admin_role_id)
            ON CONFLICT DO NOTHING;
        END IF;
        
        RAISE NOTICE 'Super admin created: admin@blockxone.local / Admin123!';
    ELSE
        RAISE NOTICE 'Super admin already exists';
    END IF;
END $$;
