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
      console.log(`  ${status === "ok" ? "ok  " : "FAIL"} ${route.file}  <- ${targetPath}`);
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

  const stale = listPngs(TARGET_DIR).filter((name) => !fresh.has(name));
  for (const name of stale) {
    fs.unlinkSync(path.join(TARGET_DIR, name));
  }
  console.log(`copied ${fresh.size} screenshot(s); removed ${stale.length} stale PNG(s)`);
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
        console.log(`  ${route.file.padEnd(38)} ${route.path}${unresolved}`);
      }
    }
    console.log(`\nchrome: ${CHROME}`);
    console.log(`puppeteer: ${PUPPETEER_ROOT}`);
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
