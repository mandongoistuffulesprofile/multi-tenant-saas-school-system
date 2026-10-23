package main

import (
	"log"
)

// main is intentionally thin: the HTTP server, router and graceful shutdown
// live in server.go (Run). Keeping a single entrypoint avoids the duplicated
// net/http server that used to live here.
func main() {
	if err := Run(); err != nil {
		log.Fatalf("api: %v", err)
	}
}
