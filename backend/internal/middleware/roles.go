package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

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
	RoleSaasAdmin   = "SAAS_ADMIN"
	RoleSuperAdmin  = "SUPER_ADMIN"
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

// RoleComplianceReaders can read consent records: school administrators manage
// the whole school, while parents and guardians see only their own records.
var RoleComplianceReaders = []string{
	RoleSchoolAdmin, RoleHead, RoleDeputy, RoleParent, RoleGuardian,
}

// RoleAllStaff is every role that works inside a school.
var RoleAllStaff = []string{
	RoleSchoolAdmin, RoleHead, RoleDeputy, RoleBursar, RoleClerk, RoleTeacher,
}

// RolePlatformAdministrators manage SaaS root operations, subscriptions and tenant onboarding.
var RolePlatformAdministrators = []string{RoleSaasAdmin, RoleSuperAdmin}

// RequireRole restricts a Gin route to one of the given roles.
// It checks all roles in the token claims (ContextRoles) to support
// multi-membership users.
func RequireRole(allowedRoles ...string) gin.HandlerFunc {
	allowed := make(map[string]struct{}, len(allowedRoles))
	for _, r := range allowedRoles {
		allowed[r] = struct{}{}
	}
	for _, r := range allowedRoles {
		allowed[r] = struct{}{}
	}
	return func(c *gin.Context) {
		if rolesVal, ok := c.Get(ContextRoles); ok {
			if roles, ok := rolesVal.([]string); ok {
				for _, role := range roles {
					if _, ok := allowed[role]; ok {
						c.Next()
						return
					}
				}
			}
		}
		// Fallback to single role for compatibility.
		if role, _ := c.Get(ContextRole); role != nil {
			if roleStr, ok := role.(string); ok {
				if _, ok := allowed[roleStr]; ok {
					c.Next()
					return
				}
			}
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "forbidden: insufficient role permissions"})
	}
}

// IsSchoolAdmin reports whether the request context carries any school-admin
// family role (SCHOOL_ADMIN, HEAD, DEPUTY).
func IsSchoolAdmin(c *gin.Context) bool {
	if rolesVal, ok := c.Get(ContextRoles); ok {
		if roles, ok := rolesVal.([]string); ok {
			for _, role := range roles {
				for _, allowed := range RoleSchoolAdministrators {
					if role == allowed {
						return true
					}
				}
			}
		}
	}
	if role, _ := c.Get(ContextRole); role != nil {
		if roleStr, ok := role.(string); ok {
			for _, allowed := range RoleSchoolAdministrators {
				if roleStr == allowed {
					return true
				}
			}
		}
	}
	return false
}
