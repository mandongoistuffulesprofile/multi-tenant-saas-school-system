package auth

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
)

// GetLinkedLearners returns the learners a parent/guardian user is linked to.
// Route: GET /me/linked-learners
func (h *Handler) GetLinkedLearners(c *gin.Context) {
	userID := c.GetString("user_id")
	tenantID := c.GetString("tenant_id")
	if tenantID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "TENANT_REQUIRED", "message": "Tenant context required"})
		return
	}

	txAny, ok := c.Get("tx")
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "NO_TX", "message": "No database transaction available"})
		return
	}
	tx, ok := txAny.(*sqlx.Tx)
	if !ok || tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "NO_TX", "message": "No database transaction available"})
		return
	}

	type LinkedLearner struct {
		LearnerID       string `json:"learner_id"`
		FirstName       string `json:"first_name"`
		LastName        string `json:"last_name"`
		AdmissionNumber string `json:"admission_number"`
		GradeLabel      string `json:"grade_label,omitempty"`
		Relationship    string `json:"relationship,omitempty"`
	}

	rows, err := tx.Query(`
		SELECT l.learner_id,
		       l.first_name,
		       l.last_name,
		       COALESCE(l.admission_number, '') AS admission_number,
		       COALESCE(g.grade_label, '') AS grade_label,
		       COALESCE(lg.relationship_type, '') AS relationship
		  FROM guardians gd
		  JOIN learner_guardians lg ON lg.guardian_id = gd.guardian_id
		  JOIN learners l ON l.learner_id = lg.learner_id
		  LEFT JOIN enrolments e ON e.learner_id = l.learner_id AND e.status = 'ACTIVE'
		  LEFT JOIN class_groups cg ON cg.class_group_id = e.class_group_id
		  LEFT JOIN grades g ON g.grade_id = cg.grade_id
		 WHERE gd.user_id = $1
		   AND gd.tenant_id = $2
		   AND l.tenant_id = $2
		 ORDER BY l.last_name, l.first_name`,
		userID, tenantID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to load linked learners"})
		return
	}
	defer rows.Close()

	learners := make([]LinkedLearner, 0)
	for rows.Next() {
		var ll LinkedLearner
		if err := rows.Scan(&ll.LearnerID, &ll.FirstName, &ll.LastName, &ll.AdmissionNumber, &ll.GradeLabel, &ll.Relationship); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to scan learner"})
			return
		}
		learners = append(learners, ll)
	}

	c.JSON(http.StatusOK, learners)
}
