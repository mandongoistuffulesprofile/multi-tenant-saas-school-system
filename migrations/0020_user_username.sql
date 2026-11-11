ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(100);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_tenant_uidx ON users (username) WHERE username IS NOT NULL;
