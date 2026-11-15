import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { translations } from "./translations";

type Locale = Record<string, unknown>;

/**
 * Merge a locale's top-level groups with its `common` bag.
 *
 * `common` holds flat, reusable keys that are exposed at the root so pages can
 * call `t("save_learner")` without a namespace. But `common` must never shadow
 * a namespaced group (e.g. `teacher`, `parent`, `saas`) — otherwise a single
 * scalar in `common` would wipe out the whole group. Groups therefore take
 * precedence, and only genuinely flat `common` entries are lifted to the root.
 */
function mergeLocale(locale: Locale): Record<string, unknown> {
  const { common, ...groups } = locale as { common?: Locale };
  const merged: Record<string, unknown> = { ...groups, common: common ?? {} };

  for (const [key, value] of Object.entries(common ?? {})) {
    if (key in merged && key !== "common") continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      merged[key] = mergeLocale(value as Locale);
      continue;
    }
    merged[key] = value;
  }

  return merged;
}

const IS_DEV = Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);

// A missing key renders as the key itself (a tab labelled "parent.child"), which
// is easy to miss and ships to demos and screenshots unnoticed. In development,
// report each one once so the next omission is loud instead of invisible. The
// handler is attached only in development: production keeps rendering the key
// rather than throwing inside a render pass.
const reportedMissingKeys = new Set<string>();

function reportMissingKey(languages: readonly string[], key: string) {
  const id = `${key}@${languages.join(",")}`;
  if (reportedMissingKeys.has(id)) return;
  reportedMissingKeys.add(id);
  console.error(
    `[i18n] missing translation for "${key}" (${languages.join(", ") || "all languages"}): ` +
      "add it to src/i18n/translations.ts — this key currently renders as its own name.",
  );
}

// The header toggle writes `app_lang`; without reading it back here the choice
// was lost on every reload and a Kiswahili user always returned to English.
function initialLanguage(): string {
  try {
    const stored = localStorage.getItem("app_lang");
    if (stored === "sw" || stored === "en") return stored;
  } catch {
    /* private mode, or no DOM */
  }
  return "en";
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: mergeLocale(translations.en as unknown as Locale) },
    sw: { translation: mergeLocale(translations.sw as unknown as Locale) },
  },
  lng: initialLanguage(),
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
  ...(IS_DEV
    ? {
        saveMissing: true,
        missingKeyHandler: (languages: readonly string[], _namespace: string, key: string) =>
          reportMissingKey(languages, key),
      }
    : {}),
});

export default i18n;
