// Command healthcheck is a tiny static probe for the distroless API image.
//
// Distroless has no shell or wget, so Docker's HEALTHCHECK cannot use a shell
// one-liner. This binary performs the same GET the compose stack used to do
// and exits non-zero on any non-200 response or transport error.
package main

import (
	"fmt"
	"net/http"
	"os"
	"time"
)

func main() {
	url := "http://127.0.0.1:8080/health/ready"
	if len(os.Args) > 1 {
		url = os.Args[1]
	}

	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		fmt.Fprintf(os.Stderr, "healthcheck: %v\n", err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		fmt.Fprintf(os.Stderr, "healthcheck: %s returned %s\n", url, resp.Status)
		os.Exit(1)
	}
}
