package auth

import (
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
)

// GetLinkedLearners returns the learners a parent/guardian user is linked to.
// Route: GET /me/linked-learners
// Auth: requires PARENT or GUARDIAN role (enforced by RequireRole middleware).
func (h *Handler) GetLinkedLearners(c *gin.Context) {
	userID := c.GetString("user_id")

	// Get the request-scoped transaction if available (set by TenantTxMiddleware).
	// This endpoint is under RequireAuthGin, so a transaction should always be present.
	var tx *sqlx.Tx
	if v, ok := c.Get("tx"); ok {
		if t, ok := v.(*sqlx.Tx); ok {
			tx = t
		}
	}
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "NO_TX", "message": "No database transaction available"})
		return
	}

	type LinkedLearner struct {
		LearnerID       string `json:"learner_id"`
		FirstName       string `json:"first_name"`
		LastName        string `json:"last_name"`
		AdmissionNumber string `json:"admission_number"`
		GradeLabel      string `json:"grade_label,omitempty"`
	}

	rows, err := tx.Query(
		`SELECT l.learner_id, l.first_name, l.last_name,
		 l.admission_number, COALESCE(g.grade_label, '') as grade_label
		 FROM guardians gd
		 JOIN learner_guardians lg ON lg.guardian_id = gd.guardian_id
		 JOIN learners l ON l.learner_id = lg.learner_id
		 LEFT JOIN enrolments e ON e.learner_id = l.learner_id AND e.status = 'ACTIVE'
		 LEFT JOIN class_groups cg ON cg.class_group_id = e.class_group_id
		 LEFT JOIN grades g ON g.grade_id = cg.grade_id
		 WHERE gd.user_id = $1
		 ORDER BY l.last_name, l.first_name`,
		userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to load linked learners"})
		return
	}
	defer rows.Close()

	learners := make([]LinkedLearner, 0)
	for rows.Next() {
		var ll LinkedLearner
		if err := rows.Scan(&ll.LearnerID, &ll.FirstName, &ll.LastName, &ll.AdmissionNumber, &ll.GradeLabel); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to scan learner"})
			return
		}
		learners = append(learners, ll)
	}

	c.JSON(http.StatusOK, learners)
}

var _ = sql.ErrNoRows