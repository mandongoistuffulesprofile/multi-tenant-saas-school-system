/**
 * One-shot password migration: scrypt at rest for every legacy plaintext row.
 * Idempotent — safe to re-run. bcrypt/argon2 rows are left untouched (we do
 * not have native verifier deps; re-hashing them would lose the credentials).
 */
import pg from 'pg';
import crypto from 'node:crypto';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/school_saas_production'
});

function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(plain), salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('hex')}$${dk.toString('hex')}`;
}

const { rows } = await pool.query(
  "SELECT id, email, password_hash FROM users WHERE password_hash NOT LIKE 'scrypt$%' AND password_hash NOT LIKE '$2%' AND password_hash NOT LIKE '$argon2%'"
);

let migrated = 0;
for (const row of rows) {
  const stored = String(row.password_hash || '').trim();
  if (!stored) { console.warn(`[Skip] ${row.email}: empty hash`); continue; }
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(stored), row.id]);
  migrated++;
}
console.log(`[OK] Migrated ${migrated}/${rows.length} plaintext password(s) to scrypt.`);
await pool.end();
