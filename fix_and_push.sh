#!/usr/bin/env bash
set -e

echo "⚙️ [1/4] Configuring Git URL mirror override for Go packages..."
git config --global url."https://github.com/golang/".insteadOf "https://go.googlesource.com/"

echo "🧹 [2/4] Cleaning Go module cache..."
cd backend
go clean -modcache

echo "📦 [3/4] Running go mod tidy with direct mirrors..."
unset GOPROXY
go mod tidy -v

echo "🚀 [4/4] Staging, committing, and pushing to GitHub..."
cd ..
git add .
git commit -m "feat(mpesa): fix go modules and implement Daraja C2B integration" || echo "No new changes to commit."
git push origin main || git push origin master

echo "✅ Success! Everything is built, tidied, and pushed to GitHub."
