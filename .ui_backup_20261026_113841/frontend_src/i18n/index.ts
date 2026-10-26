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
  const merged: Record<string, unknown> = { ...groups };

  for (const [key, value] of Object.entries(common ?? {})) {
    // Skip when a namespaced group already owns this key.
    if (key in merged) continue;
    // A nested object in `common` (e.g. `wizard`) is a group of its own and is
    // merged recursively so its keys resolve at their own namespace.
    if (value && typeof value === "object" && !Array.isArray(value)) {
      merged[key] = mergeLocale(value as Locale);
      continue;
    }
    merged[key] = value;
  }

  return merged;
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: mergeLocale(translations.en as unknown as Locale) },
    sw: { translation: mergeLocale(translations.sw as unknown as Locale) },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
