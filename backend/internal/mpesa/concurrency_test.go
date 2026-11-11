package mpesa

import (
	"context"
	"os"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
)

func TestMpesaRawInbox_IdempotentInsert(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	database, err := db.Connect(url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer database.Close()
	ctx := context.Background()
	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	tenant := "mpi-" + suffix
	transID := "TXDUP-" + suffix

	_ = database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
		_, err := tx.Exec(`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1,$2,$3)`, tenant, "S", tenant)
		return err
	})
	t.Cleanup(func() {
		_ = database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
			_, _ = tx.Exec(`DELETE FROM mpesa_raw_inbox WHERE tenant_id=$1`, tenant)
			_, _ = tx.Exec(`DELETE FROM schools WHERE tenant_id=$1`, tenant)
			return nil
		})
	})

	// Concurrent duplicate inserts must be idempotent (unique tenant_id,trans_id).
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
				_, err := tx.Exec(`INSERT INTO mpesa_raw_inbox (tenant_id, trans_id, sender_phone, sender_name, amount, account_reference, raw_payload)
					VALUES ($1,$2,$3,$4,$5::numeric,$6,$7)
					ON CONFLICT (tenant_id, trans_id) DO NOTHING`,
					tenant, transID, "254700000000", "Test", "100.00", "ADM1", []byte(`{}`))
				return err
			})
		}()
	}
	wg.Wait()

	var n int
	err = database.WithTenant(ctx, tenant, "", func(tx *db.Tx) error {
		return tx.QueryRow(`SELECT count(*) FROM mpesa_raw_inbox WHERE tenant_id=$1 AND trans_id=$2`, tenant, transID).Scan(&n)
	})
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("expected 1 inbox row, got %d", n)
	}
}
