#!/usr/bin/env node
/**
 * Keeps routes.mjs honest against frontend/src/App.tsx.
 *
 * Fails when:
 *   - App.tsx declares a route the manifest does not describe (or skip)
 *   - the manifest lists a path App.tsx no longer has
 *   - filenames are duplicated or not NN-slug.png
 *   - a photographed route has no persona
 *   - a parameterised route has neither a resolve step nor a skip
 *
 * Usage: node scripts/ui-screenshots/check-routes.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PERSONAS, routes } from "./routes.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const appPath = path.join(repoRoot, "frontend/src/App.tsx");
const appSource = fs.readFileSync(appPath, "utf8");

const declared = new Set();
for (const match of appSource.matchAll(/<Route\b[^>]*?\bpath="([^"]+)"/g)) {
  declared.add(match[1]);
}
// <Route path={...}> would be a template expression; flag it rather than guess.
const dynamicPaths = [...appSource.matchAll(/<Route\b[^>]*?\bpath=\{(?!")/g)];
if (dynamicPaths.length) {
  console.error(`${dynamicPaths.length} <Route> element(s) use a computed path; the checker only understands literals.`);
}

const problems = [];
const warnings = [];

const manifestPaths = new Map();
const files = new Map();
for (const route of routes) {
  if (manifestPaths.has(route.path)) problems.push(`duplicate manifest path: ${route.path}`);
  manifestPaths.set(route.path, route);

  if (!route.skip) {
    if (!route.file) problems.push(`${route.path} has no output filename`);
    else {
      if (files.has(route.file)) problems.push(`duplicate filename: ${route.file}`);
      files.set(route.file, route.path);
      if (!/^\d{2}-[a-z0-9-]+\.png$/.test(route.file)) {
        problems.push(`${route.path}: filename "${route.file}" is not NN-lowercase-slug.png`);
      }
    }
    if (!(route.persona in PERSONAS)) {
      problems.push(`${route.path}: unknown persona "${route.persona}"`);
    }
    if (route.path.includes(":") && !route.resolve) {
      problems.push(`${route.path}: parameterised route needs a resolve step`);
    }
  }
}

for (const declaredPath of [...declared].sort()) {
  if (!manifestPaths.has(declaredPath)) {
    problems.push(`App.tsx route not in the manifest: ${declaredPath}`);
  }
}
for (const manifestPath of [...manifestPaths.keys()].sort()) {
  if (!declared.has(manifestPath)) {
    problems.push(`manifest route no longer in App.tsx: ${manifestPath}`);
  }
}

const photographed = routes.filter((route) => !route.skip).length;
const skipped = routes.length - photographed;
const personas = {};
for (const route of routes) {
  if (route.skip) continue;
  personas[route.persona] = (personas[route.persona] ?? 0) + 1;
}

console.log(`App.tsx declares ${declared.size} path(s); manifest describes ${routes.length} (${photographed} captured, ${skipped} skipped).`);
console.log(`by persona: ${Object.entries(personas).map(([k, v]) => `${k}=${v}`).join(", ")}`);

if (warnings.length) {
  for (const warning of warnings) console.warn(`warn: ${warning}`);
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
} else {
  console.log("manifest matches the router.");
}
