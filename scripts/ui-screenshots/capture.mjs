#!/usr/bin/env node
/**
 * Capture browser-accurate screenshots of every route in routes.mjs.
 *
 * Run it where the stack is live (Vite on :5173 proxying /api to :8080, seeded
 * demo tenant). It writes into a scratch directory first and only replaces
 * docs/ui-design/screenshots when every route passed its checks:
 *
 *   node scripts/ui-screenshots/check-routes.mjs
 *   node scripts/ui-screenshots/capture.mjs --replace
 *
 * Flags (all optional):
 *   --base-url       default http://localhost:5173
 *   --api-url        default http://localhost:8080
 *   --out            scratch dir, default docs/ui-design/screenshots.new
 *   --target         live dir, default docs/ui-design/screenshots
 *   --chrome         default /usr/bin/google-chrome
 *   --puppeteer-root default /tmp/kilo/shots (module that provides puppeteer-core)
 *   --only <regex>   capture only matching paths
 *   --settle <ms>    extra wait after network idle, default 1500
 *   --replace        swap the new set into --target after all checks pass
 *   --no-backup      do not copy the old PNGs to screenshots.previous/
 *   --include-skipped  also capture routes the manifest marks as skipped
 *   --dry-run        print the plan without launching a browser
 *   --report-card-id / --tenant-id  skip API resolution for param routes
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { PERSONAS, routes } from "./routes.mjs";

const argv = process.argv.slice(2);

function flag(name, fallback) {
  const withEquals = argv.find((a) => a.startsWith(`--${name}=`));
  if (withEquals) return withEquals.slice(name.length + 3);
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const next = argv[index + 1];
  return next && !next.startsWith("--") ? next : true;
}

const BASE_URL = String(flag("base-url", "http://localhost:5173")).replace(/\/$/, "");
const API_URL = String(flag("api-url", "http://localhost:8080")).replace(/\/$/, "");
const OUT_DIR = path.resolve(String(flag("out", "docs/ui-design/screenshots.new")));
const TARGET_DIR = path.resolve(String(flag("target", "docs/ui-design/screenshots")));
const BACKUP_DIR = path.resolve(path.dirname(TARGET_DIR), "screenshots.previous");
const CHROME = String(flag("chrome", "/usr/bin/google-chrome"));
const PUPPETEER_ROOT = String(flag("puppeteer-root", "/tmp/kilo/shots"));
const ONLY = flag("only", null);
const SETTLE_MS = Number(flag("settle", 1500));
const REPLACE = Boolean(flag("replace", false));
const BACKUP = !flag("no-backup", false);
const INCLUDE_SKIPPED = Boolean(flag("include-skipped", false));
const DRY_RUN = Boolean(flag("dry-run", false));
const REPORT_CARD_ID = flag("report-card-id", null);
const TENANT_ID = flag("tenant-id", null);

const MIN_TEXT_DEFAULT = 120;
const MIN_PNG_BYTES = 10 * 1024;
const DONE_EVENT_WAIT = 60_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PREFLIGHT_TIMEOUT_MS = 4000;

function preflightFix(kind) {
  switch (kind) {
    case "chrome":
      return "install Google Chrome, or pass --chrome /path/to/chrome";
    case "api":
      return "start the API (needs PostgreSQL and Redis): cd backend && go run ./cmd/api — or point --api-url at the running one";
    case "database":
      return "start PostgreSQL (e.g. docker compose up -d postgres) and make sure DATABASE_URL points at it";
    case "redis":
      return "start Redis (e.g. docker compose up -d redis) and make sure REDIS_URL points at it";
    case "web":
      return "start the frontend: cd frontend && npm run dev — or point --base-url at the running one";
    case "puppeteer":
      return `install puppeteer-core where the harness can see it: npm install puppeteer-core (currently ${PUPPETEER_ROOT}), or pass --puppeteer-root`;
    default:
      return "check the flag values for this run";
  }
}

/**
 * Verifies the browser, the API and the dev server before any persona work, so
 * a missing service fails once with an instruction instead of ten confusing
 * per-route errors.
 */
async function preflight() {
  const problems = [];

  try {
    fs.accessSync(CHROME, fs.constants.X_OK);
  } catch {
    problems.push({ label: `Chrome at ${CHROME}`, detail: "not found or not executable", fix: preflightFix("chrome") });
  }

  const probe = async (label, url, fix) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PREFLIGHT_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
      if (response.status >= 500) {
        problems.push({ label, detail: `answered HTTP ${response.status} — the process is up but unhealthy`, fix });
      }
    } catch (error) {
      const reason = error?.name === "AbortError"
        ? `no answer within ${PREFLIGHT_TIMEOUT_MS}ms`
        : error?.cause?.code || error?.message || String(error);
      problems.push({ label, detail: `not reachable at ${url} (${reason})`, fix });
    } finally {
      clearTimeout(timer);
    }
  };

  // /health/ready also pings PostgreSQL and Redis, so a half-up stack is named
  // here instead of failing later as a wall of per-page 500s.
  const apiLabel = `API at ${API_URL}`;
  const apiController = new AbortController();
  const apiTimer = setTimeout(() => apiController.abort(), PREFLIGHT_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_URL}/health/ready`, {
      signal: apiController.signal,
      redirect: "manual",
    });
    if (response.status === 503) {
      let dependency = "";
      try {
        dependency = String((await response.json())?.dependency ?? "");
      } catch {
        // Non-JSON 503; fall through to the generic message.
      }
      problems.push({
        label: apiLabel,
        detail: dependency
          ? `answering, but its ${dependency} is unreachable (HTTP 503)`
          : "answering HTTP 503 — a dependency is down",
        fix: preflightFix(dependency || "api"),
      });
    } else if (response.status >= 500) {
      problems.push({ label: apiLabel, detail: `answered HTTP ${response.status} — up but unhealthy`, fix: preflightFix("api") });
    }
  } catch (error) {
    const reason = error?.name === "AbortError"
      ? `no answer within ${PREFLIGHT_TIMEOUT_MS}ms`
      : error?.cause?.code || error?.message || String(error);
    problems.push({ label: apiLabel, detail: `not reachable at ${API_URL}/health/ready (${reason})`, fix: preflightFix("api") });
  } finally {
    clearTimeout(apiTimer);
  }

  await probe(`dev server at ${BASE_URL}`, `${BASE_URL}/`, preflightFix("web"));

  try {
    await loadPuppeteer();
  } catch {
    problems.push({ label: "puppeteer-core", detail: "could not be loaded", fix: preflightFix("puppeteer") });
  }

  return problems;
}

async function loadPuppeteer() {
  try {
    const mod = await import("puppeteer-core");
    return mod.default ?? mod;
  } catch {
    const requireFrom = createRequire(path.join(PUPPETEER_ROOT, "index.js"));
    return requireFrom("puppeteer-core");
  }
}

/** Parses a Set-Cookie header into something page.setCookie accepts. */
function parseSetCookie(header, host) {
  const [pair, ...attributes] = header.split(";");
  const separator = pair.indexOf("=");
  if (separator === -1) return null;
  const cookie = {
    name: pair.slice(0, separator).trim(),
    value: pair.slice(separator + 1).trim(),
    domain: host,
    path: "/",
    httpOnly: false,
    secure: false,
  };
  if (!cookie.name) return null;
  for (const attribute of attributes) {
    const [rawKey, ...rest] = attribute.split("=");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join("=").trim();
    if (key === "path" && value) cookie.path = value;
    else if (key === "domain" && value) cookie.domain = value.replace(/^\./, "");
    else if (key === "httponly") cookie.httpOnly = true;
    else if (key === "secure") cookie.secure = true;
    else if (key === "samesite") {
      const sameSite = value.toLowerCase();
      cookie.sameSite = sameSite === "strict" ? "Strict" : sameSite === "none" ? "None" : "Lax";
    }
  }
  return cookie;
}

async function login(email, password) {
  const response = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`login failed for ${email}: HTTP ${response.status} ${body.slice(0, 200)}`);
  }
  const raw = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  const host = new URL(BASE_URL).hostname;
  const cookies = raw.map((header) => parseSetCookie(header, host)).filter(Boolean);
  if (!cookies.some((c) => c.name === "access_token")) {
    throw new Error(`login for ${email} did not set access_token (got: ${cookies.map((c) => c.name).join(", ") || "none"})`);
  }
  const header = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  return { cookies, header };
}

/**
 * The not-found route renders a "404" eyebrow above "Page not found".
 * Requiring both keeps an empty state that merely says "not found" from
 * masquerading as a missing route.
 */
function isNotFoundScreen(text) {
  return /\b404\b/.test(text) && /page not found/i.test(text);
}

/** Reads a list from an API response that may be a bare array or wrapped. */
function asList(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["data", "items", "tenants", "report_cards", "cards", "results"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

async function apiGet(pathname, cookieHeader) {
  const response = await fetch(`${API_URL}${pathname}`, { headers: { Cookie: cookieHeader } });
  if (!response.ok) throw new Error(`GET ${pathname} -> HTTP ${response.status}`);
  return response.json();
}

async function resolveParam(route) {
  if (route.resolve === "first-report-card") {
    if (REPORT_CARD_ID) return String(REPORT_CARD_ID);
    const session = await login(PERSONAS.admin.email, PERSONAS.admin.password);
    const payload = await apiGet("/api/v1/reports/cards", session.header);
    const card = asList(payload)[0];
    const id = card?.card_id ?? card?.id;
    if (!id) throw new Error("no report card found; seed one or pass --report-card-id");
    return String(id);
  }
  if (route.resolve === "first-tenant") {
    if (TENANT_ID) return String(TENANT_ID);
    const session = await login(PERSONAS.platform.email, PERSONAS.platform.password);
    const payload = await apiGet("/api/v1/platform/tenants", session.header);
    const tenant = asList(payload)[0];
    const id = tenant?.tenant_id ?? tenant?.id;
    if (!id) throw new Error("no tenant found; pass --tenant-id");
    return String(id);
  }
  throw new Error(`unknown resolve step: ${route.resolve}`);
}

function fillParams(route, resolved) {
  return route.path.replace(/:([A-Za-z0-9_]+)/g, () => resolved);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function listPngs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.toLowerCase().endsWith(".png")).sort();
}

async function capturePersona(browser, persona, plan, resolvedParams, results) {
  const context = typeof browser.createBrowserContext === "function"
    ? await browser.createBrowserContext()
    : await browser.createIncognitoBrowserContext();

  try {
    const page = await context.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

    if (persona !== "public") {
      const credentials = PERSONAS[persona];
      if (!credentials) throw new Error(`no credentials configured for persona "${persona}"`);
      const session = await login(credentials.email, credentials.password);
      if (typeof context.setCookie === "function") {
        await context.setCookie(...session.cookies);
      } else {
        await page.setCookie(...session.cookies);
      }
      console.log(`  logged in as ${credentials.email}`);
    }

    for (const route of plan) {
      const targetPath = fillParams(route, resolvedParams[route.path]);
      const url = `${BASE_URL}${targetPath}`;
      const outFile = path.join(OUT_DIR, route.file);
      const failures = [];
      const serverErrors = [];
      const pageErrors = [];
      let text = "";
      let status = "ok";

      const onResponse = (response) => {
        if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
      };
      const onPageError = (error) => pageErrors.push(String(error?.message ?? error));

      page.on("response", onResponse);
      page.on("pageerror", onPageError);
      try {
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: DONE_EVENT_WAIT });
        if (response && response.status() >= 400) failures.push(`document HTTP ${response.status()}`);
        try {
          await page.waitForNetworkIdle({ idleTime: 500, timeout: 15_000 });
        } catch {
          // The Vite dev server keeps an HMR socket and long-poll requests
          // alive, so "never idle" is normal here; the settle delay covers it.
        }
        if (route.waitForText) {
          await page.waitForFunction(
            (needle) => document.body.innerText.includes(needle),
            { timeout: 15_000 },
            route.waitForText,
          );
        }
        await sleep(route.settleMs ?? SETTLE_MS);

        text = await page.evaluate(() => document.body.innerText || "");

        if (route.devOnly && isNotFoundScreen(text)) {
          // /cbc-assessment and /bom-oversight are behind import.meta.env.DEV,
          // so a production build drops the route and the * fallback answers.
          // That is the build's shape, not a regression: skip instead of
          // failing minText, and keep any existing PNG for the route.
          status = "skipped";
          if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
          results.skipped.push({
            file: route.file,
            path: targetPath,
            persona,
            reason: "dev-only route: this build serves the not-found page — start the frontend with `npm run dev` to capture it",
          });
        } else {
          if (isNotFoundScreen(text)) {
            failures.push("page rendered the not-found route (is this route in the build?)");
          }
          if (/something went wrong/i.test(text)) failures.push("page shows \"Something went wrong\"");
          if (serverErrors.length) failures.push(`${serverErrors.length} API 5xx response(s)`);
          const minText = route.minText ?? MIN_TEXT_DEFAULT;
          if (text.trim().length < minText) failures.push(`only ${text.trim().length} chars of text (min ${minText})`);
          if (route.expectText && !text.includes(route.expectText)) {
            failures.push(`missing expected text "${route.expectText}"`);
          }

          await page.screenshot({ path: outFile, fullPage: true });
          const bytes = fs.statSync(outFile).size;
          if (bytes < MIN_PNG_BYTES) {
            failures.push(`screenshot is only ${bytes} bytes`);
          }

          const entry = {
            file: route.file,
            path: targetPath,
            persona,
            bytes,
            textLength: text.trim().length,
            serverErrors,
            pageErrors,
            failures,
            sample: text.replace(/\s+/g, " ").trim().slice(0, 140),
          };
          if (failures.length) {
            status = "failed";
            results.failed.push(entry);
          } else {
            results.passed.push(entry);
          }
        }
      } catch (error) {
        status = "failed";
        results.failed.push({
          file: route.file,
          path: targetPath,
          persona,
          failures: [String(error?.message ?? error)],
          serverErrors,
          pageErrors,
        });
      } finally {
        page.off("response", onResponse);
        page.off("pageerror", onPageError);
      }
      const label = status === "ok" ? "ok  " : status === "skipped" ? "skip" : "FAIL";
      console.log(`  ${label} ${route.file}  <- ${targetPath}${status === "skipped" ? " (dev-only route, not-found page served)" : ""}`);
    }
  } finally {
    await context.close();
  }
}

function promote(results) {
  ensureDir(TARGET_DIR);
  ensureDir(OUT_DIR);
  const fresh = new Set(listPngs(OUT_DIR));
  const existing = listPngs(TARGET_DIR);

  if (BACKUP && existing.length) {
    ensureDir(BACKUP_DIR);
    for (const name of existing) {
      fs.copyFileSync(path.join(TARGET_DIR, name), path.join(BACKUP_DIR, name));
    }
    console.log(`backed up ${existing.length} old PNG(s) to ${path.relative(process.cwd(), BACKUP_DIR)}`);
  }

  for (const name of fresh) {
    fs.copyFileSync(path.join(OUT_DIR, name), path.join(TARGET_DIR, name));
  }

  // A dev-only route skipped on a production build has no new PNG; do not
  // treat the existing one as stale, or the capture set would silently lose it.
  const preserved = new Set(results.skipped.map((entry) => entry.file).filter(Boolean));
  const stale = listPngs(TARGET_DIR).filter((name) => !fresh.has(name) && !preserved.has(name));
  for (const name of stale) {
    fs.unlinkSync(path.join(TARGET_DIR, name));
  }
  console.log(`copied ${fresh.size} screenshot(s); removed ${stale.length} stale PNG(s)`);
  if (preserved.size) {
    const kept = listPngs(TARGET_DIR).filter((name) => preserved.has(name));
    if (kept.length) console.log(`kept ${kept.length} skipped dev-only PNG(s): ${kept.join(", ")}`);
  }
  if (stale.length) console.log(`removed: ${stale.join(", ")}`);
}

async function main() {
  const wanted = routes.filter((route) => {
    if (!INCLUDE_SKIPPED && route.skip) return false;
    if (ONLY && !new RegExp(String(ONLY)).test(route.path)) return false;
    return true;
  });

  const byPersona = new Map();
  for (const route of wanted) {
    if (!byPersona.has(route.persona)) byPersona.set(route.persona, []);
    byPersona.get(route.persona).push(route);
  }

  if (DRY_RUN) {
    console.log(`plan: ${wanted.length} route(s) from ${BASE_URL} -> ${path.relative(process.cwd(), OUT_DIR)}`);
    for (const [persona, plan] of byPersona) {
      console.log(`\n${persona}:`);
      for (const route of plan) {
        const unresolved = route.resolve ? `  (${route.resolve})` : "";
        const devOnly = route.devOnly ? "  [dev-only: skipped on non-dev builds]" : "";
        console.log(`  ${route.file.padEnd(38)} ${route.path}${unresolved}${devOnly}`);
      }
    }
    console.log(`\nchrome: ${CHROME}`);
    console.log(`puppeteer: ${PUPPETEER_ROOT}`);
    return;
  }

  const problems = await preflight();
  if (problems.length) {
    console.error("\nPreflight failed — no screenshots were taken and nothing was replaced.\n");
    for (const problem of problems) {
      console.error(`  x ${problem.label}: ${problem.detail}`);
      console.error(`      fix: ${problem.fix}`);
    }
    console.error("\nBring the stack up, then re-run:");
    console.error(`  node scripts/ui-screenshots/capture.mjs${REPLACE ? " --replace" : ""}`);
    process.exitCode = 1;
    return;
  }

  const puppeteer = await loadPuppeteer();
  ensureDir(OUT_DIR);

  console.log(`capturing ${wanted.length} route(s) into ${path.relative(process.cwd(), OUT_DIR)}`);

  const resolvedParams = {};
  for (const route of wanted) {
    if (!route.resolve) continue;
    try {
      resolvedParams[route.path] = await resolveParam(route);
      console.log(`resolved ${route.path} -> ${resolvedParams[route.path]}`);
    } catch (error) {
      console.log(`could not resolve ${route.path}: ${error.message}`);
    }
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=2"],
  });

  const results = { passed: [], failed: [], skipped: [] };
  try {
    for (const [persona, plan] of byPersona) {
      const runnable = [];
      for (const route of plan) {
        if (route.resolve && !resolvedParams[route.path]) {
          results.skipped.push({ path: route.path, file: route.file, reason: `unresolved ${route.resolve}` });
          console.log(`  skip ${route.file} (${route.resolve} unresolved)`);
          continue;
        }
        runnable.push(route);
      }
      console.log(`\n${persona}: ${runnable.length} route(s)`);
      if (runnable.length) {
        await capturePersona(browser, persona, runnable, resolvedParams, results);
      }
    }
  } finally {
    await browser.close();
  }

  const reportPath = path.join(OUT_DIR, "capture-report.json");
  fs.writeFileSync(reportPath, JSON.stringify({ baseUrl: BASE_URL, results }, null, 2));

  console.log(`\npassed ${results.passed.length}, failed ${results.failed.length}, skipped ${results.skipped.length}`);
  console.log(`report: ${path.relative(process.cwd(), reportPath)}`);

  if (results.passed.length) {
    console.log("\ncaptured (text length / first words):");
    for (const entry of results.passed) {
      console.log(`  ${entry.file}  ${entry.textLength}c  "${entry.sample.slice(0, 70)}"`);
    }
  }

  if (results.skipped.length) {
    console.log("\nSKIPPED:");
    for (const entry of results.skipped) console.log(`  ${entry.file ?? entry.path}: ${entry.reason}`);
  }

  if (results.failed.length) {
    console.log("\nFAILURES:");
    for (const entry of results.failed) {
      console.log(`  ${entry.file} (${entry.path})`);
      for (const failure of entry.failures) console.log(`    - ${failure}`);
    }
    console.log("\nOld screenshots were left untouched.");
    process.exitCode = 1;
    return;
  }

  if (REPLACE) {
    promote(results);
  } else {
    console.log("\nAll routes passed. Re-run with --replace to swap them into " + path.relative(process.cwd(), TARGET_DIR));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
