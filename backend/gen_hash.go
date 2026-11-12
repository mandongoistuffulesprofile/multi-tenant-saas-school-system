package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"

	"golang.org/x/crypto/argon2"
)

func main() {
	salt := make([]byte, 16)
	rand.Read(salt)
	hash := argon2.IDKey([]byte("supersecret123"), salt, 3, 64*1024, 4, 32)
	fmt.Println(hex.EncodeToString(salt) + ":" + hex.EncodeToString(hash))
}