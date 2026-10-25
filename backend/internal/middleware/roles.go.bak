package middleware

// Role vocabulary used by tenant_memberships.role.
//
// The platform distinguishes two families of roles:
//
//   - School staff, who operate inside a single tenant: SCHOOL_ADMIN, HEAD,
//     DEPUTY, BURSAR, CLERK, TEACHER.
//   - Portal roles, who are linked to specific learners: PARENT, GUARDIAN.
//
// The groups below express what each family of operations requires so route
// registration reads as policy rather than a list of strings.
const (
	RoleSchoolAdmin = "SCHOOL_ADMIN"
	RoleHead        = "HEAD"
	RoleDeputy      = "DEPUTY"
	RoleBursar      = "BURSAR"
	RoleClerk       = "CLERK"
	RoleTeacher     = "TEACHER"
	RoleParent      = "PARENT"
	RoleGuardian    = "GUARDIAN"
)

// RoleSchoolAdministrators can change school-wide settings, manage staff and
// create learners.
var RoleSchoolAdministrators = []string{RoleSchoolAdmin, RoleHead, RoleDeputy}

// RoleFinanceStaff can manage money: fee structures, invoices, payments,
// credits, adjustments and refunds.
var RoleFinanceStaff = []string{RoleSchoolAdmin, RoleHead, RoleDeputy, RoleBursar}

// RoleAcademicStaff can view academic data: classes, assessments, attendance
// and reports.
var RoleAcademicStaff = []string{
	RoleSchoolAdmin, RoleHead, RoleDeputy, RoleBursar, RoleClerk, RoleTeacher,
}

// RoleAdministrationStaff can view school operations data: staff, compliance
// records, calendar and gate activity.
var RoleAdministrationStaff = []string{
	RoleSchoolAdmin, RoleHead, RoleDeputy, RoleClerk,
}

// RolePortalUsers are the parent and guardian portal roles.
var RolePortalUsers = []string{RoleParent, RoleGuardian}

// RoleAllStaff is every role that works inside a school.
var RoleAllStaff = []string{
	RoleSchoolAdmin, RoleHead, RoleDeputy, RoleBursar, RoleClerk, RoleTeacher,
}
