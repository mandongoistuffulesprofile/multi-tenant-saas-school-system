package main

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"

	"golang.org/x/crypto/argon2"
)

func main() {
	salt := make([]byte, 16)
	rand.Read(salt)
	hash := argon2.IDKey([]byte("supersecret123"), salt, 3, 64*1024, 2, 32)
	b64Salt := base64.RawStdEncoding.EncodeToString(salt)
	b64Hash := base64.RawStdEncoding.EncodeToString(hash)
	fmt.Printf("$argon2id$v=19$m=65536,t=3,p=2$%s$%s\n", b64Salt, b64Hash)
}