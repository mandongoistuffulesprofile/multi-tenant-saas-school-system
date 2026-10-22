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
