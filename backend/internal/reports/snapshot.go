package reports

import (
	"database/sql"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/grading"
)

// CardSnapshot is the frozen content of a published report card. It is the
// document of record: later edits to assessment_results never change it. A
// correction produces a new revision rather than mutating this one.
//
// The snapshot deliberately separates school results (Areas) from official
// KNEC results (National). National bands are never converted to percentages,
// merged into the school table, or ranked.
type CardSnapshot struct {
	Version       int                `json:"version"`
	GeneratedAt   string             `json:"generated_at"`
	Revision      int                `json:"revision"`
	Scale         string             `json:"scale"`
	GradeLabel    string             `json:"grade_label"`
	LevelBand     string             `json:"level_band"`
	TermLabel     string             `json:"term_label"`
	YearLabel     string             `json:"year_label"`
	Areas         []SnapshotArea     `json:"areas"`
	Aggregate     *SnapshotAggregate `json:"aggregate,omitempty"`
	Position      int                `json:"position,omitempty"`
	National      []SnapshotNational `json:"national,omitempty"`
	ShowAggregate bool               `json:"show_aggregate"`
	ShowPosition  bool               `json:"show_position"`
}

type SnapshotArea struct {
	Code       string           `json:"code"`
	Name       string           `json:"name"`
	Strand     string           `json:"strand,omitempty"`
	LevelCode  string           `json:"level_code"`
	Band       string           `json:"band"`
	Descriptor string           `json:"descriptor"`
	Points     int              `json:"points"`
	Results    []SnapshotResult `json:"results"`
	Comment    string           `json:"comment,omitempty"`
}

type SnapshotResult struct {
	AssessmentType   string  `json:"assessment_type"`
	AssessmentWindow string  `json:"assessment_window"`
	LevelCode        string  `json:"level_code,omitempty"`
	Band             string  `json:"band,omitempty"`
	Descriptor       string  `json:"descriptor,omitempty"`
	Points           int     `json:"points,omitempty"`
	RawScore         float64 `json:"raw_score,omitempty"`
	MaxScore         float64 `json:"max_score,omitempty"`
}

type SnapshotAggregate struct {
	Points     int     `json:"points"`
	MaxPoints  int     `json:"max_points"`
	Percentage float64 `json:"percentage"`
	Grade      string  `json:"grade,omitempty"`
}

// SnapshotNational is an official KNEC band. It has no percentage or rank by
// design; the descriptor is the human-readable band name.
type SnapshotNational struct {
	AssessmentType string `json:"assessment_type"`
	AssessmentYear int    `json:"assessment_year"`
	SubjectCode    string `json:"subject_code,omitempty"`
	SubjectName    string `json:"subject_name,omitempty"`
	RawBand        string `json:"raw_band"`
	Band           string `json:"band"`
	Descriptor     string `json:"descriptor"`
	Points         *int   `json:"points,omitempty"`
}

type snapshotCardRow struct {
	LearnerID   string         `db:"learner_id"`
	TermID      sql.NullString `db:"term_id"`
	LearnerName string         `db:"learner_name"`
	GradeLabel  string         `db:"grade_label"`
	LevelBand   string         `db:"level_band"`
	TermLabel   sql.NullString `db:"term_label"`
	YearLabel   sql.NullString `db:"year_label"`
}

// BuildSnapshot composes the immutable card content for one card.
func BuildSnapshot(tx *sqlx.Tx, tenantID, cardID string, cfg grading.Config, revision int) (CardSnapshot, error) {
	var meta snapshotCardRow
	err := tx.QueryRow(
		`SELECT rc.learner_id::text, rc.term_id::text,
		        TRIM(COALESCE(l.first_name,'') || ' ' || COALESCE(l.last_name,'')) AS learner_name,
		        COALESCE(g.grade_label, '') AS grade_label,
		        COALESCE(g.level_band, '') AS level_band,
		        COALESCE(t.term_label, '') AS term_label,
		        COALESCE(ay.year_label, '') AS year_label
		 FROM report_cards rc
		 JOIN learners l ON l.learner_id = rc.learner_id AND l.tenant_id = rc.tenant_id
		 LEFT JOIN grades g ON g.grade_id = rc.grade_id
		 LEFT JOIN terms t ON t.term_id = rc.term_id
		 LEFT JOIN academic_years ay ON ay.year_id = rc.academic_year_id
		 WHERE rc.tenant_id = $1 AND rc.card_id = $2`,
		tenantID, cardID,
	).Scan(&meta.LearnerID, &meta.TermID, &meta.LearnerName, &meta.GradeLabel,
		&meta.LevelBand, &meta.TermLabel, &meta.YearLabel)
	if err != nil {
		return CardSnapshot{}, err
	}
	learnerID := meta.LearnerID
	termID := meta.TermID.String

	scale := cfg.ResolveScale(meta.LevelBand)
	definition, err := cfg.Definition(scale)
	if err != nil {
		return CardSnapshot{}, err
	}

	areas, err := loadSnapshotAreas(tx, tenantID, learnerID, termID, cardID)
	if err != nil {
		return CardSnapshot{}, err
	}

	snapshot := CardSnapshot{
		Version:       1,
		GeneratedAt:   time.Now().UTC().Format(time.RFC3339),
		Revision:      revision,
		Scale:         string(scale),
		GradeLabel:    meta.GradeLabel,
		LevelBand:     meta.LevelBand,
		TermLabel:     meta.TermLabel.String,
		YearLabel:     meta.YearLabel.String,
		Areas:         areas,
		ShowAggregate: cfg.ShowAggregate,
		ShowPosition:  cfg.ShowPosition,
	}

	if cfg.ShowAggregate {
		agg := aggregateAreas(areas, definition)
		agg.Grade = snapshotGrade(definition, &agg)
		snapshot.Aggregate = &agg
	}
	national, err := loadNationalResults(tx, tenantID, learnerID, meta.YearLabel.String)
	if err != nil {
		return CardSnapshot{}, err
	}
	snapshot.National = national
	return snapshot, nil
}

func loadSnapshotAreas(tx *sqlx.Tx, tenantID, learnerID, termID, cardID string) ([]SnapshotArea, error) {
	rows, err := tx.Query(
		`SELECT la.area_id, la.code, la.name, COALESCE(st.name, ''),
		        ae.assessment_type, ae.assessment_window,
		        COALESCE(ar.level_code, ''), COALESCE(ar.points, 0),
		        COALESCE(ar.raw_score, 0), COALESCE(ar.max_score, 0),
		        COALESCE(rcc.comment_text, '')
		 FROM assessment_results ar
		 JOIN assessment_events ae ON ae.event_id = ar.event_id
		 JOIN learning_areas la ON la.area_id = ae.learning_area_id
		 LEFT JOIN sub_strands ss ON ss.sub_strand_id = ar.sub_strand_id
		 LEFT JOIN strands st ON st.strand_id = ss.strand_id
		 LEFT JOIN report_card_comments rcc
		   ON rcc.card_id = NULLIF($4, '')::uuid AND rcc.learning_area_id = la.area_id
		 WHERE ar.tenant_id = $1 AND ar.learner_id = $2
		   AND (NULLIF($3, '')::uuid IS NULL OR ae.term_id = NULLIF($3, '')::uuid)
		   AND ar.state IN ('SUBMITTED', 'MODERATED', 'PUBLISHED', 'LOCKED')
		 ORDER BY la.sort_order, la.name, ae.assessment_type, ae.assessment_window`,
		tenantID, learnerID, termID, cardID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	order := make([]string, 0)
	byArea := make(map[string]*SnapshotArea)
	for rows.Next() {
		var areaID, code, name, strand string
		var result SnapshotResult
		var levelCode, comment string
		var points float64
		if err := rows.Scan(&areaID, &code, &name, &strand,
			&result.AssessmentType, &result.AssessmentWindow,
			&levelCode, &points, &result.RawScore, &result.MaxScore,
			&comment); err != nil {
			return nil, err
		}
		result.Points = int(points)
		result.LevelCode = grading.NormalizeCode(levelCode)
		result.Band = grading.BandOf(result.LevelCode)
		result.Descriptor = grading.DescriptorFor(result.LevelCode)
		if area, ok := byArea[areaID]; ok {
			area.Results = append(area.Results, result)
			continue
		}
		area := &SnapshotArea{Code: code, Name: name, Strand: strand, Comment: comment}
		area.Results = []SnapshotResult{result}
		byArea[areaID] = area
		order = append(order, areaID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	areas := make([]SnapshotArea, 0, len(order))
	for _, id := range order {
		area := byArea[id]
		applyHeadlineLevel(area)
		areas = append(areas, *area)
	}
	return areas, nil
}

// applyHeadlineLevel chooses the level shown in the area's headline cell. A
// summative result wins over formative/SBA evidence; otherwise the most recent
// result in curriculum order is used. Every captured row stays visible in
// Results, so SBA and summative evidence are never merged into one number.
func applyHeadlineLevel(area *SnapshotArea) {
	if len(area.Results) == 0 {
		return
	}
	chosen := area.Results[len(area.Results)-1]
	for i := range area.Results {
		if strings.EqualFold(area.Results[i].AssessmentType, "SUMMATIVE") {
			chosen = area.Results[i]
		}
	}
	if chosen.LevelCode == "" {
		return
	}
	area.LevelCode = chosen.LevelCode
	area.Band = chosen.Band
	area.Descriptor = chosen.Descriptor
	area.Points = chosen.Points
}

func aggregateAreas(areas []SnapshotArea, definition grading.ScaleDefinition) SnapshotAggregate {
	points := 0
	counted := 0
	for _, area := range areas {
		if area.LevelCode == "" {
			continue
		}
		points += area.Points
		counted++
	}
	maxPoints := counted * definition.MaxPoints
	agg := SnapshotAggregate{Points: points, MaxPoints: maxPoints}
	if maxPoints > 0 {
		agg.Percentage = float64(points) / float64(maxPoints) * 100
	}
	return agg
}

func loadNationalResults(tx *sqlx.Tx, tenantID, learnerID, yearLabel string) ([]SnapshotNational, error) {
	var year int
	if parsed, err := strconv.Atoi(strings.TrimSpace(yearLabel)); err == nil {
		year = parsed
	}
	rows, err := tx.Query(
		`SELECT n.assessment_type, n.assessment_year,
		        COALESCE(n.subject_code, ''), COALESCE(la.name, ''),
		        n.raw_band, n.points
		 FROM national_assessment_results n
		 LEFT JOIN learning_areas la ON la.area_id = n.learning_area_id
		 WHERE n.tenant_id = $1 AND n.learner_id = $2
		   AND ($3 = 0 OR n.assessment_year = $3)
		   AND n.superseded_by IS NULL
		 ORDER BY n.assessment_year DESC, n.assessment_type, la.sort_order, la.name`,
		tenantID, learnerID, year,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]SnapshotNational, 0)
	for rows.Next() {
		var n SnapshotNational
		var points sql.NullInt64
		if err := rows.Scan(&n.AssessmentType, &n.AssessmentYear,
			&n.SubjectCode, &n.SubjectName, &n.RawBand, &points); err != nil {
			return nil, err
		}
		n.Band = grading.BandOf(n.RawBand)
		n.Descriptor = grading.DescriptorFor(n.RawBand)
		if points.Valid {
			p := int(points.Int64)
			n.Points = &p
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// AssignPositions ranks snapshots by aggregate points when the tenant has
// explicitly enabled ranking. Ties share a position.
func AssignPositions(snapshots []*CardSnapshot) {
	type entry struct {
		snapshot *CardSnapshot
		points   int
	}
	ranked := make([]entry, 0, len(snapshots))
	for _, s := range snapshots {
		if s == nil || s.Aggregate == nil {
			continue
		}
		ranked = append(ranked, entry{snapshot: s, points: s.Aggregate.Points})
	}
	sort.SliceStable(ranked, func(i, j int) bool { return ranked[i].points > ranked[j].points })
	position := 0
	previous := -1
	for i, e := range ranked {
		if e.points != previous {
			position = i + 1
			previous = e.points
		}
		e.snapshot.Position = position
	}
}

func marshalSnapshot(snapshot CardSnapshot) ([]byte, error) {
	return json.Marshal(snapshot)
}

func snapshotGrade(def grading.ScaleDefinition, agg *SnapshotAggregate) string {
	if agg == nil {
		return ""
	}
	for _, level := range def.Levels {
		if agg.Percentage >= level.MinPercent {
			return level.Code
		}
	}
	return ""
}
