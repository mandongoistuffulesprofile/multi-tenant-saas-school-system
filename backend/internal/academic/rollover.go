// Package academic implements the year-end academic workflow: moving learners
// from one academic year to the next.
//
// The rollover is planned before it is applied. The plan is a pure function of
// the school's grade ladder and its active enrolments, so the preview a head
// teacher approves is the same computation the write path uses.
package academic

import (
	"database/sql"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/audit"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
)

type Service struct {
	database *db.DB
}

func NewService(database *db.DB) *Service {
	return &Service{database: database}
}

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// Grade is one rung of the school's ladder (PP1..Grade 9).
type Grade struct {
	GradeID    string `json:"grade_id"`
	GradeLabel string `json:"grade_label"`
	LevelBand  string `json:"level_band"`
}

// SourceGroup is the number of active learners in one grade/stream of the
// year being closed.
type SourceGroup struct {
	GradeID    string
	GradeLabel string
	StreamID   string
	Learners   int
}

// GradeMove is the plan for one source grade: where its learners go and how
// many of them there are. ToGradeID is empty when the grade is the last rung,
// which means those learners graduate instead of moving up.
type GradeMove struct {
	FromGradeID    string `json:"from_grade_id"`
	FromGradeLabel string `json:"from_grade_label"`
	ToGradeID      string `json:"to_grade_id,omitempty"`
	ToGradeLabel   string `json:"to_grade_label,omitempty"`
	Learners       int    `json:"learners"`
	Streams        int    `json:"streams"`
}

// Plan is the dry-run result: what the rollover would do, per grade.
type Plan struct {
	TotalLearners int         `json:"total_learners"`
	Promoted      int         `json:"promoted"`
	Graduating    int         `json:"graduating"`
	Moves         []GradeMove `json:"moves"`
}

// NextGrade returns the rung immediately above current. Grades are ordered by
// the Kenyan ladder rather than by ID: PP1, PP2, then Grade 1..Grade 9. An
// unknown or terminal grade has no next rung.
func NextGrade(grades []Grade, current string) (Grade, bool) {
	ordered := orderedGrades(grades)
	rank, ok := gradeRank(current)
	if !ok {
		return Grade{}, false
	}
	for _, g := range ordered {
		if r, ok := gradeRank(g.GradeID); ok && r > rank {
			return g, true
		}
	}
	return Grade{}, false
}

// BuildPlan maps every active source group onto its next grade and totals the
// learners moved. Learners in a grade with no successor graduate.
func BuildPlan(grades []Grade, sources []SourceGroup) Plan {
	plan := Plan{Moves: []GradeMove{}}
	byGrade := map[string]*GradeMove{}
	order := []string{}

	for _, src := range sources {
		key := src.GradeID
		move, seen := byGrade[key]
		if !seen {
			next, ok := NextGrade(grades, src.GradeID)
			move = &GradeMove{
				FromGradeID:    src.GradeID,
				FromGradeLabel: src.GradeLabel,
				Learners:       0,
				Streams:        0,
			}
			if ok {
				move.ToGradeID = next.GradeID
				move.ToGradeLabel = next.GradeLabel
			}
			byGrade[key] = move
			order = append(order, key)
		}
		move.Learners += src.Learners
		move.Streams++
		if src.GradeLabel != "" {
			move.FromGradeLabel = src.GradeLabel
		}
	}

	sort.SliceStable(order, func(i, j int) bool {
		ri, _ := gradeRank(order[i])
		rj, _ := gradeRank(order[j])
		return ri < rj
	})

	for _, key := range order {
		move := byGrade[key]
		plan.TotalLearners += move.Learners
		if move.ToGradeID == "" {
			plan.Graduating += move.Learners
		} else {
			plan.Promoted += move.Learners
		}
		plan.Moves = append(plan.Moves, *move)
	}
	return plan
}

func orderedGrades(grades []Grade) []Grade {
	ordered := make([]Grade, len(grades))
	copy(ordered, grades)
	sort.SliceStable(ordered, func(i, j int) bool {
		ri, oki := gradeRank(ordered[i].GradeID)
		rj, okj := gradeRank(ordered[j].GradeID)
		if oki != okj {
			return oki
		}
		return ri < rj
	})
	return ordered
}

// gradeRank assigns PP1=1, PP2=2, Grade 1=3 ... Grade 9=11. Unknown formats
// sort after the known ladder so a custom label can never displace a real
// rung in the preview.
func gradeRank(gradeID string) (int, bool) {
	s := strings.ToUpper(strings.TrimSpace(gradeID))
	switch {
	case strings.HasPrefix(s, "PP"):
		n, err := strconv.Atoi(strings.TrimPrefix(s, "PP"))
		if err != nil || n < 1 {
			return 0, false
		}
		return n, true
	case strings.HasPrefix(s, "G"):
		n, err := strconv.Atoi(strings.TrimPrefix(s, "G"))
		if err != nil || n < 1 {
			return 0, false
		}
		return 2 + n, true
	default:
		return 0, false
	}
}

// ShouldApply decides whether a rollover request writes. Preview is the safe
// default: omitting both flags can never promote anyone. A caller must opt in
// with `apply: true` or `dry_run: false`; `apply` wins over `dry_run` when a
// client sends both.
func ShouldApply(apply, dryRun *bool) bool {
	if apply != nil {
		return *apply
	}
	if dryRun != nil {
		return !*dryRun
	}
	return false
}

// Rollover previews or applies the move from one academic year to the next.
//
//	POST /academic/rollover                 preview (default)
//	POST /academic/rollover {"apply":true}  apply
//	POST /academic/rollover {"dry_run":false} apply
//
// Omitting the flags, or sending dry_run:true, only ever previews. The query
// parameter ?dry_run=true also forces a preview for an otherwise applying
// request. Graduating learners keep their learner record and their enrolment
// is marked COMPLETED rather than deleted.
func (h *Handler) Rollover(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}

	var req struct {
		FromYearID string `json:"from_year_id" binding:"required"`
		ToYearID   string `json:"to_year_id" binding:"required"`
		// Pointers distinguish "not sent" from an explicit false, so a
		// client that omits both flags gets the preview-only default.
		Apply  *bool `json:"apply"`
		DryRun *bool `json:"dry_run"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	if req.FromYearID == req.ToYearID {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "to_year_id", Code: "INVALID_VALUE", Message: "'to_year_id' must differ from 'from_year_id'"},
		})
		return
	}
	tenantID := c.GetString("tenant_id")

	var years int
	if err := tx.QueryRow(
		`SELECT count(*) FROM academic_years WHERE tenant_id = $1 AND year_id IN ($2, $3)`,
		tenantID, req.FromYearID, req.ToYearID,
	).Scan(&years); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if years != 2 {
		validation.NotFound(c, "Academic year not found")
		return
	}

	grades, err := loadGrades(tx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	sources, err := loadSourceGroups(tx, tenantID, req.FromYearID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	plan := BuildPlan(grades, sources)

	if !ShouldApply(req.Apply, req.DryRun) || c.Query("dry_run") == "true" {
		c.JSON(http.StatusOK, gin.H{
			"dry_run":    true,
			"from_year":  req.FromYearID,
			"to_year":    req.ToYearID,
			"plan":       plan,
			"total":      plan.TotalLearners,
			"promoted":   plan.Promoted,
			"graduating": plan.Graduating,
		})
		return
	}

	promoted, graduating, err := applyRollover(tx, tenantID, req.FromYearID, req.ToYearID, grades, sources)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	// Only an applied rollover is audited: previews change nothing, and the
	// event is attributed to the signed-in administrator in the same
	// transaction as the promotion.
	audit.TenantAction(tx, c, "ACADEMIC_ROLLOVER_APPLIED", "academic_years", req.ToYearID,
		RolloverAuditDetails(req.FromYearID, req.ToYearID, promoted, graduating))
	c.JSON(http.StatusOK, gin.H{
		"dry_run":    false,
		"from_year":  req.FromYearID,
		"to_year":    req.ToYearID,
		"plan":       plan,
		"promoted":   promoted,
		"graduating": graduating,
	})
}

// RolloverAuditDetails is the audit payload for an applied rollover. It keeps
// the year identity and the counts a reviewer needs, and no learner PII.
func RolloverAuditDetails(fromYear, toYear string, promoted, graduating int) map[string]any {
	return map[string]any{
		"from_year_id":   fromYear,
		"to_year_id":     toYear,
		"promoted":       promoted,
		"graduating":     graduating,
		"total_learners": promoted + graduating,
	}
}

func loadGrades(tx *sqlx.Tx) ([]Grade, error) {
	rows, err := tx.Query(`SELECT grade_id, grade_label, level_band FROM grades`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	grades := make([]Grade, 0, 12)
	for rows.Next() {
		var g Grade
		if err := rows.Scan(&g.GradeID, &g.GradeLabel, &g.LevelBand); err != nil {
			return nil, err
		}
		grades = append(grades, g)
	}
	return grades, rows.Err()
}

func loadSourceGroups(tx *sqlx.Tx, tenantID, yearID string) ([]SourceGroup, error) {
	rows, err := tx.Query(
		`SELECT cg.grade_id, COALESCE(g.grade_label, cg.grade_id), cg.stream_id, count(e.learner_id)
		 FROM enrolments e
		 JOIN class_groups cg ON cg.class_group_id = e.class_group_id AND cg.tenant_id = e.tenant_id
		 LEFT JOIN grades g ON g.grade_id = cg.grade_id
		 WHERE e.tenant_id = $1 AND e.year_id = $2 AND e.status = 'ACTIVE'
		 GROUP BY cg.grade_id, g.grade_label, cg.stream_id
		 ORDER BY cg.grade_id, cg.stream_id`,
		tenantID, yearID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	groups := []SourceGroup{}
	for rows.Next() {
		var src SourceGroup
		if err := rows.Scan(&src.GradeID, &src.GradeLabel, &src.StreamID, &src.Learners); err != nil {
			return nil, err
		}
		groups = append(groups, src)
	}
	return groups, rows.Err()
}

func applyRollover(tx *sqlx.Tx, tenantID, fromYear, toYear string, grades []Grade, sources []SourceGroup) (promoted, graduating int, err error) {
	for _, src := range sources {
		next, ok := NextGrade(grades, src.GradeID)
		if !ok {
			res, execErr := tx.Exec(
				`UPDATE enrolments SET status = 'COMPLETED', ended_on = CURRENT_DATE
				 WHERE tenant_id = $1 AND year_id = $2 AND status = 'ACTIVE'
				   AND class_group_id IN (
				     SELECT class_group_id FROM class_groups
				     WHERE tenant_id = $1 AND year_id = $2 AND grade_id = $3 AND stream_id = $4)`,
				tenantID, fromYear, src.GradeID, src.StreamID)
			if execErr != nil {
				return promoted, graduating, execErr
			}
			affected, _ := res.RowsAffected()
			graduating += int(affected)
			continue
		}

		targetID, findErr := findOrCreateClassGroup(tx, tenantID, toYear, next.GradeID, src.StreamID)
		if findErr != nil {
			return promoted, graduating, findErr
		}
		res, execErr := tx.Exec(
			`UPDATE enrolments SET class_group_id = $1, year_id = $2
			 WHERE tenant_id = $3 AND year_id = $4 AND status = 'ACTIVE'
			   AND class_group_id IN (
			     SELECT class_group_id FROM class_groups
			     WHERE tenant_id = $3 AND year_id = $4 AND grade_id = $5 AND stream_id = $6)`,
			targetID, toYear, tenantID, fromYear, src.GradeID, src.StreamID)
		if execErr != nil {
			return promoted, graduating, execErr
		}
		affected, _ := res.RowsAffected()
		promoted += int(affected)
	}
	return promoted, graduating, nil
}

func findOrCreateClassGroup(tx *sqlx.Tx, tenantID, yearID, gradeID, streamID string) (string, error) {
	var classGroupID string
	err := tx.QueryRow(
		`SELECT class_group_id FROM class_groups
		 WHERE tenant_id = $1 AND year_id = $2 AND grade_id = $3 AND stream_id = $4
		 LIMIT 1`,
		tenantID, yearID, gradeID, streamID,
	).Scan(&classGroupID)
	if err == nil {
		return classGroupID, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	err = tx.QueryRow(
		`INSERT INTO class_groups (tenant_id, year_id, grade_id, stream_id)
		 VALUES ($1, $2, $3, $4) RETURNING class_group_id`,
		tenantID, yearID, gradeID, streamID,
	).Scan(&classGroupID)
	return classGroupID, err
}
