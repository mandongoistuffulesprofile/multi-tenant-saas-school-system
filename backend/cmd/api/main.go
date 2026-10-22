package main

import (
	"log"
	"os"
)

func main() {
	if err := Run(); err != nil {
		log.Fatal(err)
		os.Exit(1)
	}
}
