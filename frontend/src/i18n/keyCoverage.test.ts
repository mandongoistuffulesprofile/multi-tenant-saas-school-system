import { describe, expect, it } from "vitest";
import i18n from "./index";

/**
 * Every literal key a page passes to t() must exist in both locales. The
 * runtime reporter (missingKey.test.ts) only fires for keys a rendered screen
 * actually reaches, so a key behind a modal or an error branch can ship as its
 * own name. This walks the source instead.
 *
 * The glob is Vite's (types from vite-env.d.ts). It has to be written inline:
 * Vite only rewrites the literal import.meta.glob call, not an alias to it.
 */
const CALL = /\bt\(\s*["']([A-Za-z0-9_.-]+)["']/g;

describe("translation key coverage", () => {
  const keys = new Map<string, string[]>();
  const files = import.meta.glob<string>("../**/*.{ts,tsx}", {
    query: "?raw",
    import: "default",
    eager: true,
  });
  for (const [file, text] of Object.entries(files)) {
    const rel = file.replace(/^\.\.\//, "");
    if (rel.startsWith("i18n/") || /\.test\.(ts|tsx)$/.test(rel)) continue;
    for (const match of text.matchAll(CALL)) {
      const list = keys.get(match[1]) ?? [];
      if (!list.includes(rel)) list.push(rel);
      keys.set(match[1], list);
    }
  }

  it("finds keys to check", () => {
    expect(keys.size).toBeGreaterThan(50);
  });

  it("has every literal t() key in English and Kiswahili", () => {
    const missing: string[] = [];
    for (const [key, sources] of keys) {
      for (const lng of ["en", "sw"]) {
        if (!i18n.exists(key, { lng })) missing.push(`${key} (${lng}) in ${sources.join(", ")}`);
      }
    }
    expect(missing, `${missing.length} missing key(s)`).toEqual([]);
  });
});
