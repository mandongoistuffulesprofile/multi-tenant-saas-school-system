package auth

import (
	"errors"
	"runtime"
	"sync"
	"time"
)

var (
	ErrServerTooBusy = errors.New("mfumo una shughuli nyingi, tafadhali subiri sekunde chache (server busy)")
)

// AuthSemaphore bounds memory-intensive Argon2id password hashing routines
type AuthSemaphore struct {
	sem chan struct{}
}

var (
	globalAuthSem *AuthSemaphore
	once          sync.Once
)

// GetAuthSemaphore initializes a semaphore bounded to 2x runtime CPU cores
func GetAuthSemaphore() *AuthSemaphore {
	once.Do(func() {
		limit := runtime.NumCPU() * 2
		if limit < 2 {
			limit = 2
		}
		globalAuthSem = &AuthSemaphore{
			sem: make(chan struct{}, limit),
		}
	})
	return globalAuthSem
}

// ExecuteWithGuard executes the argon2id hashing routine under strict concurrency control
func (s *AuthSemaphore) ExecuteWithGuard(timeout time.Duration, task func() error) error {
	select {
	case s.sem <- struct{}{}:
		defer func() { <-s.sem }()
		return task()
	case <-time.After(timeout):
		return ErrServerTooBusy
	}
}
