/* Shared request context, guards and small helpers for the extension API. */

export function makeContext(deps) {
  const { verifyJwt, bearerToken, parseCookies, UUID_RE } = deps;

  function ctx(req) {
    const claims = verifyJwt(bearerToken(req) || parseCookies(req.headers.cookie || '').accessToken || '') || {};
    return {
      claims,
      userId: claims.sub || null,
      role: claims.role || null,
      tenantId: claims.tenant_id && UUID_RE.test(String(claims.tenant_id)) ? claims.tenant_id : null,
      email: (claims.email || '').toLowerCase(),
      imp: !!claims.imp,
      ip: req.socket?.remoteAddress || null,
    };
  }

  /* Express middleware: attaches req._ctx for every request. Routes that
   * need auth can then reject on !req._ctx.userId themselves. Cheap HMAC
   * verify only — no DB round trip. */
  function attachContext(req, _res, next) {
    req._ctx = ctx(req);
    next();
  }

  return { ctx, attachContext };
}

export const FIN_ADMIN = ['admin', 'saas_admin', 'system_admin', 'head', 'deputy', 'bursar', 'accountant', 'clerk'];
export const isParentRole = (role) => role === 'parent';
export const money = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const ref = (prefix) =>
  `${prefix}-${Date.now().toString(36).toUpperCase()}${String(Math.floor(Math.random() * 900) + 100)}`;
export const today = () => new Date().toISOString().slice(0, 10);

export function guard(handler, allowed) {
  return (req, res) => {
    const c = req._ctx;
    if (!c?.userId) return res.status(401).json({ success: false, message: 'Authentication required.' });
    if (allowed && !allowed.includes(c.role)) {
      return res.status(403).json({ success: false, message: 'Not permitted for your role.' });
    }
    return handler(req, res, c);
  };
}

export function auditRow(c, req) {
  return [c.tenantId, c.userId, c.email, c.ip];
}

/* Wrap async handlers so rejects never hang the connection. */
export function h(fn) {
  return (req, res) => {
    Promise.resolve(fn(req, res, req._ctx)).catch((err) => {
      console.error('[Ext API]', err.message, err.detail || '', err.hint || '',
        (err.stack || '').split('\n')[1] || '');
      if (!res.headersSent) res.status(500).json({ success: false, message: 'Internal error.' });
    });
  };
}
