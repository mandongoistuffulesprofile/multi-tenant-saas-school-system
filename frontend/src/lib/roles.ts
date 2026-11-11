/**
 * Role vocabulary and permission groups.
 *
 * These mirror the groups enforced by the backend's RequireRole middleware
 * (backend/internal/middleware/roles.go). Keep both sides in step: a route
 * guarded here with a group the backend rejects would render a page that then
 * fails every request, and vice versa.
 */

export const Role = {
  SchoolAdmin: "SCHOOL_ADMIN",
  Head: "HEAD",
  Deputy: "DEPUTY",
  Bursar: "BURSAR",
  Clerk: "CLERK",
  Teacher: "TEACHER",
  Parent: "PARENT",
  Guardian: "GUARDIAN",
  SaasAdmin: "SAAS_ADMIN",
  SuperAdmin: "SUPER_ADMIN",
} as const;

/** Can change school-wide settings, manage staff and create learners. */
export const SCHOOL_ADMIN_ROLES = [Role.SchoolAdmin, Role.Head, Role.Deputy];

/** Can manage money: fee structures, invoices, payments, categories. */
export const FINANCE_ROLES = [Role.SchoolAdmin, Role.Head, Role.Deputy, Role.Bursar];

/** Can view academic data: classes, assessments, attendance and reports. */
export const ACADEMIC_ROLES = [
  Role.SchoolAdmin,
  Role.Head,
  Role.Deputy,
  Role.Bursar,
  Role.Clerk,
  Role.Teacher,
];

/** Can view school operations data: staff, compliance, calendar, comms. */
export const ADMIN_ROLES = [Role.SchoolAdmin, Role.Head, Role.Deputy, Role.Clerk];

/**
 * Human-readable labels for the raw role codes shown in the top bar.
 * Mirrors the backend role vocabulary; a code with no entry falls back to
 * the code itself rather than leaking "school_admin" to a School Head.
 */
export const ROLE_LABELS: Record<string, string> = {
  SCHOOL_ADMIN: "School Administrator",
  HEAD: "Head Teacher",
  DEPUTY: "Deputy Head",
  BURSAR: "Bursar",
  CLERK: "Clerk",
  TEACHER: "Teacher",
  PARENT: "Parent",
  GUARDIAN: "Guardian",
  SAAS_ADMIN: "Platform Administrator",
  SUPER_ADMIN: "Super Administrator",
};

export function formatRoles(roles: string[]): string {
  return roles
    .map((r) => ROLE_LABELS[r] || r.replace(/_/g, " ").toLowerCase())
    .join(", ");
}
