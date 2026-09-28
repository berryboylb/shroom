DROP TABLE IF EXISTS auth_identities CASCADE;
DROP INDEX IF EXISTS idx_refresh_tokens_token_hash;
UPDATE users SET password_hash = '!google-login-disabled' WHERE password_hash IS NULL;
ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
