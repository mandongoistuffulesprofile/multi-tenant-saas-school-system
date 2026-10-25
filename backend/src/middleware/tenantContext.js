/**
 * Middleware: Resolves tenant context from header or subdomain and sets DB session context
 */
module.exports = (dbPool) => {
  return async (req, res, next) => {
    // 1. Resolve from Nginx custom header, query, or standard header
    const tenantId = req.headers['x-tenant-id'] || req.headers['x-tenant-subdomain'];

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'Missing tenant context. Ensure X-Tenant-ID header is provided.'
      });
    }

    req.tenantId = tenantId;

    // Attach a scoped query helper that sets the PostgreSQL RLS context
    req.scopedQuery = async (queryText, params = []) => {
      const client = await dbPool.connect();
      try {
        await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
        const result = await client.query(queryText, params);
        return result;
      } finally {
        client.release();
      }
    };

    next();
  };
};
