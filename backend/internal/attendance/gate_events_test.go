package attendance

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
)

// TestGateEndpointsResolveHolderNames covers the gate log and the tag list
// showing a person rather than a fragment of a record ID. Each holder type
// resolves from its own table: learners and guardians by their primary key,
// staff through the tenant membership (falling back to the account email when
// no profile name is set).
//
// Needs TEST_DATABASE_URL and is skipped otherwise, like the other RLS tests.
func TestGateEndpointsResolveHolderNames(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	database, err := db.Connect(url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer database.Close()

	suffix := time.Now().UnixNano()
	tenantID := fmt.Sprintf("gate-names-%d", suffix)

	var learnerID, guardianID, staffUserID, staffMembershipID, deviceID string
	if err := database.WithTenant(t.Context(), tenantID, "", func(tx *db.Tx) error {
		if _, err := tx.Exec(
			`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1, $2, $3)`,
			tenantID, "Gate Names School", tenantID,
		); err != nil {
			return err
		}
		if err := tx.QueryRow(
			`INSERT INTO learners (tenant_id, admission_number, first_name, last_name)
			 VALUES ($1, $2, 'Amina', 'Wanjiru') RETURNING learner_id`,
			tenantID, fmt.Sprintf("GN-%d", suffix%1000000),
		).Scan(&learnerID); err != nil {
			return err
		}
		if err := tx.QueryRow(
			`INSERT INTO guardians (tenant_id, first_name, last_name, phone_number)
			 VALUES ($1, 'Grace', 'Wanjiru', $2) RETURNING guardian_id`,
			tenantID, fmt.Sprintf("2547%d", suffix%10000000),
		).Scan(&guardianID); err != nil {
			return err
		}
		// The gate reads staff names from users.first_name/last_name (staff_profiles
		// holds employment data), so the name has to be on the account itself.
		if err := tx.QueryRow(
			`INSERT INTO users (email, phone_number, password_hash, email_norm, first_name, last_name)
			 VALUES ($1::varchar, $2, 'x:x', $1::text, 'John', 'Kiptoo') RETURNING user_id::text`,
			fmt.Sprintf("gate-staff-%d@example.test", suffix), fmt.Sprintf("2547%d", (suffix/3)%10000000),
		).Scan(&staffUserID); err != nil {
			return err
		}
		if err := tx.QueryRow(
			`INSERT INTO tenant_memberships (user_id, tenant_id, role)
			 VALUES ($1, $2, 'TEACHER') RETURNING membership_id`,
			staffUserID, tenantID,
		).Scan(&staffMembershipID); err != nil {
			return err
		}
		if err := tx.QueryRow(
			`INSERT INTO gate_devices (tenant_id, device_name, device_type, pairing_code, is_paired)
			 VALUES ($1, 'Main gate kiosk', 'KIOSK', $2, true) RETURNING device_id`,
			tenantID, fmt.Sprintf("PG%011d", suffix%100000000000),
		).Scan(&deviceID); err != nil {
			return err
		}
		for _, row := range []struct{ holderType, holderID string }{
			{"LEARNER", learnerID},
			{"GUARDIAN", guardianID},
			{"STAFF", staffMembershipID},
		} {
			if _, err := tx.Exec(
				`INSERT INTO gate_events (tenant_id, device_id, holder_type, holder_id,
					event_type, verified, verified_at)
				 VALUES ($1, $2, $3, $4, 'ENTRY', true, now())`,
				tenantID, deviceID, row.holderType, row.holderID,
			); err != nil {
				return err
			}
		}
		for _, row := range []struct{ uid, holderType, holderID string }{
			{"04:AA:00:01", "LEARNER", learnerID},
			{"04:AA:00:02", "GUARDIAN", guardianID},
			{"04:AA:00:03", "STAFF", staffMembershipID},
		} {
			if _, err := tx.Exec(
				`INSERT INTO rfid_tags (tenant_id, tag_uid, holder_type, holder_id)
				 VALUES ($1, $2, $3, $4)`,
				tenantID, row.uid, row.holderType, row.holderID,
			); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatalf("create fixture: %v", err)
	}
	t.Cleanup(func() {
		_ = database.WithTenant(t.Context(), tenantID, "", func(tx *db.Tx) error {
			_, _ = tx.Exec(`DELETE FROM rfid_tags WHERE tenant_id = $1`, tenantID)
			_, _ = tx.Exec(`DELETE FROM gate_events WHERE tenant_id = $1`, tenantID)
			_, _ = tx.Exec(`DELETE FROM gate_devices WHERE tenant_id = $1`, tenantID)
			_, _ = tx.Exec(`DELETE FROM staff_profiles WHERE membership_id = $1`, staffMembershipID)
			_, _ = tx.Exec(`DELETE FROM tenant_memberships WHERE user_id = $1`, staffUserID)
			_, _ = tx.Exec(`DELETE FROM guardians WHERE tenant_id = $1`, tenantID)
			_, _ = tx.Exec(`DELETE FROM learners WHERE tenant_id = $1`, tenantID)
			_, _ = tx.Exec(`DELETE FROM schools WHERE tenant_id = $1`, tenantID)
			return nil
		})
		_, _ = database.Exec(`DELETE FROM users WHERE user_id = $1`, staffUserID)
	})

	tenantTx, err := database.BeginTenantTx(tenantID, "")
	if err != nil {
		t.Fatalf("begin tenant tx: %v", err)
	}
	defer tenantTx.Rollback()

	want := map[string]string{
		"LEARNER":  "Amina Wanjiru",
		"GUARDIAN": "Grace Wanjiru",
		"STAFF":    "John Kiptoo",
	}
	handler := NewHandler(NewService(database))

	gin.SetMode(gin.TestMode)
	eventsRecorder := httptest.NewRecorder()
	eventsCtx, _ := gin.CreateTestContext(eventsRecorder)
	eventsCtx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/gate/events", nil)
	eventsCtx.Set("tenant_id", tenantID)
	eventsCtx.Set("tx", tenantTx.Tx)

	handler.ListGateEvents(eventsCtx)

	if eventsRecorder.Code != http.StatusOK {
		t.Fatalf("events status = %d, body = %s", eventsRecorder.Code, eventsRecorder.Body.String())
	}
	var events []GateEvent
	if err := json.Unmarshal(eventsRecorder.Body.Bytes(), &events); err != nil {
		t.Fatalf("decode events body %q: %v", eventsRecorder.Body.String(), err)
	}
	if len(events) != 3 {
		t.Fatalf("got %d events, want 3", len(events))
	}
	for _, event := range events {
		if event.HolderName != want[event.HolderType] {
			t.Errorf("%s tap holder name = %q, want %q", event.HolderType, event.HolderName, want[event.HolderType])
		}
	}

	// The tag list must name its holder too, so an issued badge is recognisable.
	tagsRecorder := httptest.NewRecorder()
	tagsCtx, _ := gin.CreateTestContext(tagsRecorder)
	tagsCtx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/gate/tags", nil)
	tagsCtx.Set("tenant_id", tenantID)
	tagsCtx.Set("tx", tenantTx.Tx)

	handler.ListRFIDTags(tagsCtx)

	if tagsRecorder.Code != http.StatusOK {
		t.Fatalf("tags status = %d, body = %s", tagsRecorder.Code, tagsRecorder.Body.String())
	}
	var tags []RFIDTag
	if err := json.Unmarshal(tagsRecorder.Body.Bytes(), &tags); err != nil {
		t.Fatalf("decode tags body %q: %v", tagsRecorder.Body.String(), err)
	}
	if len(tags) != 3 {
		t.Fatalf("got %d tags, want 3", len(tags))
	}
	for _, tag := range tags {
		if tag.HolderName != want[tag.HolderType] {
			t.Errorf("%s tag holder name = %q, want %q", tag.HolderType, tag.HolderName, want[tag.HolderType])
		}
	}
}
