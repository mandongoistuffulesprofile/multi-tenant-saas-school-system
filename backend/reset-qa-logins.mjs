import crypto from 'node:crypto'; import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/school_saas_production' });
const make = (p) => { const s = crypto.randomBytes(16); const dk = crypto.scryptSync(p, s, 32, { N: 16384, r: 8, p: 1 }); return `scrypt$16384$8$1$${s.toString('hex')}$${dk.toString('hex')}`; };
const emails = process.argv.slice(2);
for (const e of emails) { const r = await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [make(process.env.RESET_PW || 'Yna@Sku1App'), e]); console.log(e, r.rowCount ? 'reset' : 'NOT FOUND'); }
await pool.end();
