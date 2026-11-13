/**
 * Post-build step: give the service worker the exact list of hashed Vite
 * bundles so a cold offline launch can boot the app shell.
 *
 * `public/sw.js` ships with two placeholders (`__BUILD_REVISION__` and
 * `__PRECACHE_ASSETS__`). The revision is a hash of the file list, so any code
 * change produces a new cache name and `activate` drops the old cache.
 *
 * The rewritten worker is recompressed here because nginx serves precompressed
 * .br/.gz sidecars (`brotli_static` / `gzip_static`); a stale sidecar would
 * hand clients the previous worker.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";

const dist = path.resolve(process.argv[2] ?? "dist");
const swPath = path.join(dist, "sw.js");

if (!fs.existsSync(swPath)) {
  throw new Error(`[precache] ${swPath} not found — run vite build first`);
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const assetsDir = path.join(dist, "assets");
const assets = fs.existsSync(assetsDir)
  ? walk(assetsDir)
      .filter((file) => /\.(js|css|woff2?|ttf|png|jpe?g|svg|webp|ico)$/i.test(file))
      .map((file) => `/${path.relative(dist, file).split(path.sep).join("/")}`)
      .sort()
  : [];

if (assets.length === 0) {
  throw new Error("[precache] no assets found in dist/assets — refusing to ship an empty precache list");
}

const revision = createHash("sha256").update(assets.join("\n")).digest("hex").slice(0, 10);

let worker = fs.readFileSync(swPath, "utf8");
for (const token of ["__BUILD_REVISION__", "__PRECACHE_ASSETS__"]) {
  const occurrences = worker.split(token).length - 1;
  if (token === "__PRECACHE_ASSETS__" && occurrences !== 1) {
    throw new Error(
      `[precache] dist/sw.js must contain exactly one ${token} (found ${occurrences}); the worker template changed`,
    );
  }
  if (occurrences === 0) {
    throw new Error(
      `[precache] dist/sw.js must contain at least one ${token} (found 0); the worker template changed`,
    );
  }
}
worker = worker
  .replaceAll("__BUILD_REVISION__", revision)
  .replace("__PRECACHE_ASSETS__", JSON.stringify(assets, null, 2));

fs.writeFileSync(swPath, worker);
fs.writeFileSync(
  `${swPath}.br`,
  brotliCompressSync(Buffer.from(worker), { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } }),
);
fs.writeFileSync(`${swPath}.gz`, gzipSync(Buffer.from(worker), { level: 9 }));

console.log(
  `[precache] revision ${revision} · ${assets.length} bundles · sw.js ${Buffer.byteLength(worker)} B`,
);
