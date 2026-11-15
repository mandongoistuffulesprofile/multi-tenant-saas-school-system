#!/usr/bin/env node
// Fails when the SPA calls an API path the server never registers.
//
// The 16 mismatches in docs/audit/2026-11-15-codebase-audit.md were found by hand,
// and a later one (`/assessments/cbc/bulk-sync`) sat in the tree until someone
// noticed the 404. Both come from the same blind spot: nothing compared the two
// sides. This is that comparison, kept small enough to run on every push.
//
// It is a static check, not a substitute for calling the endpoints: it knows the
// literal paths in `api.get("/...")` and the routes in cmd/api/server.go, and it
// normalises ids (`:id`, `${x}`, `/:id`) to a placeholder. A path assembled from
// variables is reported rather than guessed at.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const serverFile = join(root, "backend/cmd/api/server.go");
const frontendDir = join(root, "frontend/src");

// Paths that are deliberately not literal, with the reason. Keep this short: an
// entry here is a place the check cannot see.
const ALLOWED_DYNAMIC = [
  // Built as `\`/finance/learners/${id}/statement\``: the prefix is literal, the id is not.
  "/finance/learners/",
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(tsx?|jsx?)$/.test(entry)) out.push(path);
  }
  return out;
}

// --- server routes -----------------------------------------------------------
// server.go builds routes from groups: `g := apiV1.Group("/platform")` then
// `g.GET("/plans", ...)`. Track each group variable's prefix as the file is read.
function serverRoutes(source) {
  const prefix = new Map([["apiV1", "/api/v1"], ["router", ""]]);
  const routes = new Set();
  const lines = source.split("\n");
  for (const line of lines) {
    if (/^\s*\/\//.test(line)) continue;
    const group = line.match(/(\w+)\s*:?=\s*(\w+)\.Group\("([^"]*)"\)/);
    if (group) {
      prefix.set(group[1], (prefix.get(group[2]) ?? "") + group[3]);
      continue;
    }
    const route = line.match(/\b(\w+)\.(GET|POST|PUT|PATCH|DELETE)\("([^"]*)"/);
    if (!route) continue;
    const base = prefix.get(route[1]);
    if (base === undefined) continue;
    // The SPA's api client carries "/api/v1" as its baseURL, so call sites never
    // repeat it. Compare the paths as the page writes them.
    routes.add(`${route[2]} ${normalise((base + route[3]).replace(/^\/api\/v1/, ""))}`);
  }
  return routes;
}

// --- frontend calls ----------------------------------------------------------
const CALL = /\bapi\.(get|post|put|patch|delete)\(\s*[`'"]([^`'"]*)[`'"]/g;

function normalise(path) {
  return path
    .split("?")[0]
    .replace(/\$\{[^}]*\}/g, ":p")
    .replace(/\/:[A-Za-z_][\w]*/g, "/:p")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "");
}

function frontendCalls() {
  const calls = [];
  for (const file of walk(frontendDir)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(CALL)) {
      const method = match[1].toUpperCase();
      const path = match[2];
      if (!path.startsWith("/")) continue; // absolute URLs are not this API
      calls.push({ method, path, where: file.slice(root.length) });
    }
  }
  return calls;
}

const routes = serverRoutes(readFileSync(serverFile, "utf8"));
const calls = frontendCalls();
const unmatched = [];
const seen = new Set();

for (const call of calls) {
  const key = `${call.method} ${normalise(call.path)}`;
  if (seen.has(key)) continue;
  seen.add(key);
  if (routes.has(key)) continue;
  if (ALLOWED_DYNAMIC.some((prefix) => call.path.startsWith(prefix))) continue;
  unmatched.push({ ...call, key });
}

if (unmatched.length > 0) {
  console.error("SPA calls with no matching server route:");
  for (const call of unmatched) {
    console.error(`  ${call.key}  (${call.where})`);
  }
  console.error(
    `\n${unmatched.length} unmatched of ${seen.size} distinct calls, against ${routes.size} registered routes.`,
  );
  console.error("Either register the route, point the page at the right one, or add an explained entry to ALLOWED_DYNAMIC.");
  process.exit(1);
}

console.log(`API contract OK: ${seen.size} distinct SPA calls match ${routes.size} registered routes.`);
