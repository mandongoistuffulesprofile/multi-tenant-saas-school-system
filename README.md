# Kenyan Primary School Management System (SaaS)
# Implementation Plan: docs/idea1.doc - idea5.doc
# Plan: /home/yna/.local/share/kilo/plans/kenyan-primary-saas-implementation-plan.md

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Go 1.21+ (for backend development)
- Node.js 18+ (for frontend development)

### 1. Start Infrastructure
```bash
cd infrastructure/docker
docker-compose up -d
```

### 2. Run Database Migrations
```bash
# Apply Slice 0 migrations
psql -h localhost -U skulapp -d skulapp -f migrations/slice0/001_foundation.sql
```

### 3. Backend (Go)
```bash
cd backend
cp .env.example .env
# Edit .env with your values
go mod tidy
go run cmd/api/main.go
```

### 4. Frontend
```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

### 5. Access
- API: http://localhost:8080
- Frontend: http://localhost:5173
- PostgreSQL: localhost:5432

## Architecture

See `/home/yna/.local/share/kilo/plans/kenyan-primary-saas-implementation-plan.md` for full details.

## Key Design Decisions

- **Multi-tenancy:** Shared PostgreSQL with RLS FORCED on all tenant tables
- **Authentication:** JWT + refresh tokens, argon2id password hashing
- **CBC Assessment:** Event-based history (not single-row overwrite)
- **Fees:** Allocation-based (not amount_paid on invoices)
- **Offline-first:** Teacher PWA with IndexedDB (RxDB/PouchDB)
- **M-Pesa:** Daraja C2B/STK/B2C with TransID idempotency
- **i18n:** English + Kiswahili
# multi-tenant-saas-school-system
