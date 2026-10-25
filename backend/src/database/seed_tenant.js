const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/school_saas_production'
});

async function seed() {
  const subdomain = process.argv[2] || 'demo';
  const schoolName = process.argv[3] || 'Alliance High School';

  console.log(`[*] Seeding school: ${schoolName} (${subdomain})...`);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Upsert Tenant
    const tenantRes = await client.query(
      `INSERT INTO tenants (subdomain, school_name)
       VALUES ($1, $2)
       ON CONFLICT (subdomain) DO UPDATE SET school_name = EXCLUDED.school_name
       RETURNING id`,
      [subdomain, schoolName]
    );
    const tenantId = tenantRes.rows[0].id;

    // Set RLS scope
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);

    // 2. Seed Users across all 4 production roles
    const sampleUsers = [
      { email: 'admin@school.co.ke', role: 'admin', name: 'Dr. Christopher Khaemba' },
      { email: 'teacher@school.co.ke', role: 'teacher', name: 'Mwalimu James Mwangi' },
      { email: 'accountant@school.co.ke', role: 'accountant', name: 'Grace Nekesa (Bursar)' },
      { email: 'parent@school.co.ke', role: 'parent', name: 'Otieno Senior (Parent)' }
    ];

    for (const u of sampleUsers) {
      await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, full_name, role)
         VALUES ($1, $2, 'password123', $3, $4)
         ON CONFLICT (tenant_id, email) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role`,
        [tenantId, u.email, u.name, u.role]
      );
    }

    // 3. Seed Students
    const sampleStudents = [
      { adm: 'ADM-101', name: 'Achieng Otieno', grade: 'Grade 4', parent: 'parent@school.co.ke' },
      { adm: 'ADM-102', name: 'Brian Kiprop', grade: 'Grade 4', parent: 'parent@school.co.ke' },
      { adm: 'ADM-103', name: 'Faith Wanjiku', grade: 'Grade 4', parent: 'wanjiku.parent@gmail.com' },
      { adm: 'ADM-104', name: 'David Mutua', grade: 'Grade 4', parent: 'mutua.parent@gmail.com' }
    ];

    for (const student of sampleStudents) {
      const sRes = await client.query(
        `INSERT INTO students (tenant_id, admission_number, full_name, grade_level, parent_email)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, admission_number) DO UPDATE SET full_name = EXCLUDED.full_name
         RETURNING id`,
        [tenantId, student.adm, student.name, student.grade, student.parent]
      );
      const studentId = sRes.rows[0].id;

      await client.query(
        `INSERT INTO fee_balances (tenant_id, student_id, total_invoiced, total_paid)
         VALUES ($1, $2, 35000.00, 15000.00)
         ON CONFLICT (tenant_id, student_id) DO NOTHING`,
        [tenantId, studentId]
      );
    }

    await client.query('COMMIT');
    console.log(`[SUCCESS] Seeded school '${schoolName}' with 4 role-based users and learners.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[-] Seed failed:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
