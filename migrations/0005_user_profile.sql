-- 0005_user_profile.sql — global display names.
--
-- users is the global identity table (D5). Staff profiles carry employment
-- data, not identity, and the legacy schema had nowhere to store a staff
-- member's name. Keep names on the identity row so login and /me do not need a
-- tenant-specific join.

ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name varchar(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name varchar(100);
