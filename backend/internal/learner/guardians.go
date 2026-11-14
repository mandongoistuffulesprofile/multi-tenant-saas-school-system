package learner

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
)

// guardianRow is what a picker needs to choose a guardian by sight rather than
// by pasting a UUID.
type guardianRow struct {
	GuardianID   string `json:"guardian_id"`
	FullName     string `json:"full_name"`
	PhoneNumber  string `json:"phone_number"`
	Email        string `json:"email,omitempty"`
	LearnerCount int    `json:"learner_count"`
}

// ListGuardians lists the tenant's guardians with how many learners each one is
// linked to. The gate tag form uses it so a badge is issued to a person, not to
// a mistyped identifier.
func (h *Handler) ListGuardians(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	rows, err := tx.Query(
		`SELECT g.guardian_id::text, g.first_name || ' ' || g.last_name, g.phone_number,
			COALESCE(g.email, ''), count(lg.learner_id)
		 FROM guardians g
		 LEFT JOIN learner_guardians lg ON lg.guardian_id = g.guardian_id
		 WHERE g.tenant_id = $1
		 GROUP BY g.guardian_id
		 ORDER BY g.first_name, g.last_name`,
		c.GetString("tenant_id"),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	// Empty slice, not nil: the UI renders a list and null reads as failure.
	guardians := make([]guardianRow, 0)
	for rows.Next() {
		var g guardianRow
		if err := rows.Scan(&g.GuardianID, &g.FullName, &g.PhoneNumber, &g.Email, &g.LearnerCount); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		guardians = append(guardians, g)
	}
	c.JSON(http.StatusOK, guardians)
}
