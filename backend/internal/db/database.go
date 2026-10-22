package db

import (
	"database/sql"
	"fmt"
	"log"
	"math/rand"
	"sync"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/lib/pq"
)

// DB is a thin wrapper over sqlx.DB with pooled connections,
// per-statement/idle timeouts, retry with backoff+jitter, and a circuit breaker.
type DB struct {
	*sqlx.DB
	cb *circuitBreaker
}

// poolSettings holds tunable connection-pool limits. Values are sized so the
// aggregate across app instances stays below Postgres max_connections (200 in
// docker-compose, reserving connections for superuser/maintenance).
type poolSettings struct {
	MaxOpenConns int
	MaxIdleConns int
	ConnMaxIdle  time.Duration
	ConnMaxLife  time.Duration
}

func defaultPoolSettings() poolSettings {
	return poolSettings{
		MaxOpenConns: 20,
		MaxIdleConns: 8,
		ConnMaxIdle:  5 * time.Minute,
		ConnMaxLife:  30 * time.Minute,
	}
}

// Connect opens a pooled connection to Postgres and applies session-level
// guards (statement timeout, idle-in-transaction timeout, application name).
func Connect(databaseURL string) (*DB, error) {
	return ConnectWithSettings(databaseURL, defaultPoolSettings())
}

// ConnectWithSettings opens a pooled connection with explicit pool limits.
func ConnectWithSettings(databaseURL string, ps poolSettings) (*DB, error) {
	db, err := sqlx.Open("postgres", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	db.SetMaxOpenConns(ps.MaxOpenConns)
	db.SetMaxIdleConns(ps.MaxIdleConns)
	db.SetConnMaxIdleTime(ps.ConnMaxIdle)
	db.SetConnMaxLifetime(ps.ConnMaxLife)

	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	// Session-level guards. These apply for the life of each pooled connection
	// and protect against runaway queries and idle-in-transaction leaks.
	_, err = db.Exec(`
		SET statement_timeout = '30s';
		SET idle_in_transaction_session_timeout = '600s';
		SET application_name = 'skulapp-api';
	`)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to apply session guards: %w", err)
	}

	d := &DB{DB: db, cb: newCircuitBreaker(5, 30*time.Second)}
	log.Printf("Database connected (max_open=%d max_idle=%d)", ps.MaxOpenConns, ps.MaxIdleConns)
	return d, nil
}

func (db *DB) Close() error {
	return db.DB.Close()
}

// SetTenantContext sets the RLS tenant context for the current transaction.
// It must be called inside a transaction (SET LOCAL) so the value does not leak
// across pooled connections. Use BeginTenantTx / BeginReadTx which set it for you.
func (db *DB) SetTenantContext(tenantID string) error {
	_, err := db.Exec("SET LOCAL app.current_tenant_id = $1", tenantID)
	if err != nil {
		return fmt.Errorf("failed to set tenant context: %w", err)
	}
	return nil
}

// SetSessionContext sets tenant + user context at the session level so that
// RLS policies are enforced for every query issued during the current
// request/connection. Unlike SetTenantContext this is NOT scoped to a
// transaction — it applies until explicitly reset or the connection is
// returned to the pool.
//
// Call this from HTTP middleware before any handler runs. The values are
// reset by ResetSessionContext or automatically when the connection is
// closed/returned to the pool.
func (db *DB) SetSessionContext(tenantID, userID string) error {
	_, err := db.Exec("SET app.current_tenant_id = $1", tenantID)
	if err != nil {
		return fmt.Errorf("failed to set session tenant context: %w", err)
	}
	_, err = db.Exec("SET app.current_user_id = $1", userID)
	if err != nil {
		return fmt.Errorf("failed to set session user context: %w", err)
	}
	return nil
}

// ResetSessionContext clears the session-level tenant/user settings.
func (db *DB) ResetSessionContext() error {
	_, err := db.Exec("RESET app.current_tenant_id")
	if err != nil {
		return err
	}
	_, err = db.Exec("RESET app.current_user_id")
	return err
}

// SetUserContext sets the RLS user context for the current transaction.
func (db *DB) SetUserContext(userID string) error {
	_, err := db.Exec("SET LOCAL app.current_user_id = $1", userID)
	if err != nil {
		return fmt.Errorf("failed to set user context: %w", err)
	}
	return nil
}

// ResetContext clears tenant/user session settings (defensive; SET LOCAL rolls
// back automatically at transaction end).
func (db *DB) ResetContext() error {
	if _, err := db.Exec("RESET app.current_tenant_id"); err != nil {
		return err
	}
	if _, err := db.Exec("RESET app.current_user_id"); err != nil {
		return err
	}
	return nil
}

// Tx wraps a transaction with automatic tenant/user context setting.
type Tx struct {
	*sqlx.Tx
	tenantID string
	userID   string
}

// BeginTenantTx starts a read/write transaction and sets tenant + user context
// via SET LOCAL so RLS policies are enforced for the duration of the tx.
func (db *DB) BeginTenantTx(tenantID, userID string) (*Tx, error) {
	tx, err := db.Beginx()
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec("SET LOCAL app.current_tenant_id = $1", tenantID); err != nil {
		tx.Rollback()
		return nil, err
	}
	if _, err := tx.Exec("SET LOCAL app.current_user_id = $1", userID); err != nil {
		tx.Rollback()
		return nil, err
	}
	return &Tx{Tx: tx, tenantID: tenantID, userID: userID}, nil
}

// BeginReadTx starts a read-only transaction and sets tenant + user context.
// Use for read paths that must be enforced by RLS rather than explicit WHERE clauses.
func (db *DB) BeginReadTx(tenantID, userID string) (*Tx, error) {
	tx, err := db.Beginx()
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec("SET TRANSACTION READ ONLY"); err != nil {
		tx.Rollback()
		return nil, err
	}
	if _, err := tx.Exec("SET LOCAL app.current_tenant_id = $1", tenantID); err != nil {
		tx.Rollback()
		return nil, err
	}
	if _, err := tx.Exec("SET LOCAL app.current_user_id = $1", userID); err != nil {
		tx.Rollback()
		return nil, err
	}
	return &Tx{Tx: tx, tenantID: tenantID, userID: userID}, nil
}

func (tx *Tx) Commit() error {
	return tx.Tx.Commit()
}

func (tx *Tx) Rollback() error {
	return tx.Tx.Rollback()
}

// transientPGCode reports whether a lib/pq error code warrants a retry.
func transientPGCode(code string) bool {
	switch code {
	case "40001", // serialization_failure
		"40P01", // deadlock_detected
		"57P01", // admin_shutdown
		"57P02", // crash_shutdown
		"57P03", // cannot_connect_now
		"08003", // connection_exception
		"08006", // connection_failure
		"08001": // sql_client_unable_to_establish_sqlconnection
		return true
	}
	return false
}

// DoWithRetry executes an idempotent function, retrying with exponential
// backoff + jitter on transient Postgres failures. Short-circuits when the
// circuit breaker is open. fn must be safe to run more than once.
func (db *DB) DoWithRetry(fn func() error) error {
	if db.cb.state() == open {
		return fmt.Errorf("circuit breaker open: database calls rejected")
	}

	const maxAttempts = 5
	base := 50 * time.Millisecond
	var lastErr error

	for attempt := 0; attempt < maxAttempts; attempt++ {
		if attempt > 0 {
			multiplier := 1 << (attempt - 1)
			backoff := time.Duration(float64(base) * float64(multiplier))
			jitter := time.Duration(rand.Float64() * float64(backoff))
			time.Sleep(backoff + jitter)
		}

		err := fn()
		if err == nil {
			db.cb.success()
			return nil
		}

		if isTransient(err) {
			lastErr = err
			db.cb.fail()
			continue
		}
		return err
	}

	db.cb.fail()
	return fmt.Errorf("database operation failed after %d attempts: %w", maxAttempts, lastErr)
}

// isTransient inspects lib/pq errors and connection errors for retryability.
func isTransient(err error) bool {
	if err == nil {
		return false
	}
	if e, ok := err.(*pq.Error); ok && transientPGCode(string(e.Code)) {
		return true
	}
	// Generic connection-level errors are also transient.
	msg := err.Error()
	for _, marker := range []string{
		"connection refused",
		"connection reset",
		"connection terminated",
		"unexpected response",
		"canceling statement",
		"terminating connection",
		"no such host",
		"i/o timeout",
		"context deadline exceeded",
	} {
		if contains(msg, marker) {
			return true
		}
	}
	return false
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (func() bool {
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	})()
}

// ---------- circuit breaker ----------

type cbState int

const (
	closed cbState = iota
	open
	halfOpen
)

type circuitBreaker struct {
	mu        sync.Mutex
	st        cbState
	failures  int
	threshold int
	openUntil time.Time
	timeout   time.Duration
}

func newCircuitBreaker(threshold int, timeout time.Duration) *circuitBreaker {
	return &circuitBreaker{
		st:        closed,
		threshold: threshold,
		timeout:   timeout,
	}
}

func (c *circuitBreaker) state() cbState {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.st == open && time.Now().After(c.openUntil) {
		c.st = halfOpen
	}
	return c.st
}

func (c *circuitBreaker) success() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.failures = 0
	c.st = closed
}

func (c *circuitBreaker) fail() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.failures++
	if c.failures >= c.threshold {
		c.st = open
		c.openUntil = time.Now().Add(c.timeout)
	}
}

// Compile-time check that database/sql types are used (avoid unused import noise in some builds).
var _ = sql.ErrNoRows
