-- 0005_force_rls.sql — make RLS apply to table owners too.
--
-- ENABLE ROW LEVEL SECURITY does not apply to the table owner. In this
-- deployment the application role can own tables (it does locally), so without
-- FORCE every query would silently bypass tenant isolation. Force it on every
-- table that has a tenant_id column.
--
-- Global reference tables (plans, grades, ...) have no tenant_id and are
-- intentionally left alone.

DO $$
DECLARE
    tbl record;
BEGIN
    FOR tbl IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id'
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND NOT a.attisdropped
    LOOP
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl.relname);
    END LOOP;
END $$;
