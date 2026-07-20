-- Add password support for email/password login
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
