/**
 * Lightweight UI copy for the executive dashboard shell.
 *
 * The full application uses react-i18next (`src/i18n`); this module only holds
 * the small, flat dictionary the shell needs so App can switch languages
 * without pulling the i18n runtime into every render.
 */

export type Language = "en" | "sw";

export interface ShellTranslations {
  nav_reports: string;
  nav_dashboard: string;
  nav_fees: string;
  nav_assessment: string;
  nav_students: string;
  lock_screen: string;
}

export const translations: Record<Language, ShellTranslations> = {
  en: {
    nav_reports: "Reports",
    nav_dashboard: "School Dashboard",
    nav_fees: "Fees Management",
    nav_assessment: "CBC Assessment",
    nav_students: "Learners (NEMIS)",
    lock_screen: "Lock Screen",
  },
  sw: {
    nav_reports: "Ripoti",
    nav_dashboard: "Dashibodi ya Shule",
    nav_fees: "Usimamizi wa Ada",
    nav_assessment: "Tathmini ya CBC",
    nav_students: "Sajili ya Wanafunzi (NEMIS)",
    lock_screen: "Funga Skrini",
  },
};
