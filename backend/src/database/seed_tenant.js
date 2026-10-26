import pg from 'pg';
import crypto from 'node:crypto';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/school_saas_production'
});

function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(plain), salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('hex')}$${dk.toString('hex')}`;
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO tenants (subdomain, school_name)
      VALUES ('demo', 'Alliance High School')
      ON CONFLICT (subdomain) DO NOTHING;
    `);
    // Passwords are ALWAYS seeded hashed — plaintext never touches the DB.
    await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, role)
       VALUES ((SELECT id FROM tenants LIMIT 1), $1, $2, $3, $4)
       ON CONFLICT (tenant_id, email) DO NOTHING;`,
      ['dev.admin@skulapp.test', hashPassword('password123'), 'System Administrator', 'admin']
    );
    console.log('[SUCCESS] Database seeded with dev.admin@skulapp.test (scrypt-hashed credentials)');
  } catch (err) {
    console.warn('[Seeder Info]', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}
seed();
