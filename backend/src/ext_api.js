/**
 * SKULAPP EXTENSION API — thin installer.
 * server.js calls installExtApi(app, deps) just before app.listen.
 *
 * Responsibilities:
 *  1. Attach the JWT context middleware (req._ctx) globally — h() handlers
 *     read it; routes enforce their own auth/role gates.
 *  2. Bootstrap the extension schema (idempotent, once, on first request).
 *  3. Provide shared helpers (childIdsOf) and register every domain module.
 */
import { SCHEMA } from './ext/schema.js';
import { makeContext } from './ext/context.js';
import { installAuthExt } from './ext/auth_ext.js';
import { installFinance } from './ext/finance.js';
import { installAcademic } from './ext/academic.js';
import { installPeople } from './ext/people.js';
import { installCompliance } from './ext/compliance.js';
import { installPlatformExt } from './ext/platform_ext.js';
import { installCalendar } from './ext/calendar.js';
import { installParent } from './ext/parent.js';
import { installLedger } from './ext/ledger.js';

export function installExtApi(app, deps) {
  const { pool, verifyJwt, bearerToken, parseCookies, hashPassword, verifyPassword, signJwt, UUID_RE } = deps;

  const { attachContext } = makeContext({ verifyJwt, bearerToken, parseCookies, UUID_RE });

  /* 1. Global context attach — cheap HMAC verify, no DB round trip. */
  app.use(attachContext);

  /* 2. Schema bootstrap (runs once per process). */
  let bootPromise = null;
  const ensureSchema = () => (bootPromise ||= pool.connect()
    .then((client) => client.query(SCHEMA).finally(() => client.release()))
    .then(() => console.log('[Ext API] schema ready'))
    .catch((err) => {
      console.error('[Ext API] schema bootstrap failed:', err.message);
      bootPromise = null; // allow a later request to retry
      throw err;
    }));

  /* Hook the pool so the first DB-touching ext request guarantees bootstrap
   * has completed (core server queries already work; ext tables must exist). */
  const waitForSchema = () => ensureSchema();

  /* 3. Shared helpers available to every domain. */
  async function childIdsOf(client, ctxv) {
    const { rows } = await client.query(
      `SELECT s.id FROM students s WHERE s.tenant_id = $1 AND LOWER(COALESCE(s.parent_email,'')) = $2
       UNION SELECT s.id FROM students s JOIN parent_children pc ON pc.student_id = s.id WHERE pc.parent_user_id = $1`,
      [ctxv.tenantId, ctxv.email]
    );
    return rows.map((r) => r.id);
  }

  const domainDeps = {
    ...deps,
    ensureSchema,
    waitForSchema,
    childIdsOf,
  };

  /* 4. Schema completion gate BEFORE the domain routes — every ext request
   *    awaits bootstrap so the handlers never see missing tables. */
  app.use((req, res, next) => {
    waitForSchema().then(() => next(), () => next());
  });

  /* 5. Register all domains. Order is irrelevant (distinct paths). */
  installAuthExt(app, domainDeps);
  installFinance(app, domainDeps);
  installAcademic(app, domainDeps);
  installPeople(app, domainDeps);
  installCompliance(app, domainDeps);
  installPlatformExt(app, domainDeps);
  installCalendar(app, domainDeps);
  installParent(app, domainDeps);
  const ledger = installLedger(app, domainDeps);
  // server.js's Daraja webhook reads this to feed the forensic chain (additive).
  app.set('ledgerIngest', ledger.ingestC2B);

  console.log('[Ext API] domains installed: auth_ext, finance, academic, people, compliance, platform_ext, calendar, parent, ledger');
}
