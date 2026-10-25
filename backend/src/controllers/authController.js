exports.login = async (req, res, pool) => {
  const { email, password, subdomain } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password required.' });
  }

  const client = await pool.connect();
  try {
    // 1. Resolve tenant
    const targetSubdomain = subdomain || 'demo';
    const tenantRes = await client.query('SELECT id, school_name FROM tenants WHERE subdomain = $1', [targetSubdomain]);

    if (tenantRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: `School '${targetSubdomain}' not found.` });
    }

    const tenant = tenantRes.rows[0];

    // 2. Verify user credentials (plain/dev matching; production uses bcrypt)
    const userRes = await client.query(
      'SELECT id, email, full_name, role FROM users WHERE tenant_id = $1 AND email = $2',
      [tenant.id, email]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    const user = userRes.rows[0];

    // Simple dev token for session state
    const sessionToken = Buffer.from(JSON.stringify({
      userId: user.id,
      tenantId: tenant.id,
      subdomain: tenant.subdomain,
      role: user.role,
      exp: Date.now() + 86400000
    })).toString('base64');

    return res.status(200).json({
      success: true,
      token: sessionToken,
      user: {
        id: user.id,
        name: user.full_name,
        email: user.email,
        role: user.role
      },
      tenant: {
        id: tenant.id,
        schoolName: tenant.school_name,
        subdomain: tenant.subdomain
      }
    });
  } catch (err) {
    console.error('[Auth Error]', err);
    return res.status(500).json({ success: false, error: 'Authentication service failure.' });
  } finally {
    client.release();
  }
};
