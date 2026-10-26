# Phase 3 — Kenya CBC Platform Modules

You are working in `/home/yna/Desktop/New Folder` (Go backend + React frontend). Phase 2 (tenant-tx conversion) and Phase 1 infra are complete. Migration 0019 (custom_attributes, delegated_entry_tokens, mpesa_holding_tank, export_audit_logs) and frontend offline engine + BroadsheetGrid + CBC rubric converter already exist.

## Objective
Implement the remaining Kenya CBC platform modules end-to-end (backend Go handlers/services + frontend where needed), one module per commit, with tests.

## Modules (in order)
1. Delegated PIN auth + sandboxed entry API
   - Generate 4-digit PIN valid 4h scoped to class+subjects; /entry route; PENDING_REVIEW state; Headteacher/DOS approval.
2. In-kind fee engine + store dispatch
   - Process produce drops (Maize/Beans): credit student ledger + increment inventory; deferred kitchen requisition with FIFO deduction; variance <=5% auto-reconcile.
3. M-Pesa holding tank matching API
   - Unmatched Paybill transactions; single-click match to student admission number; status UNMATCHED/RESOLVED/REFUNDED.
4. CBC rubric converter + SBA completeness audit
   - Auto-translate raw % to CBC sub-levels (EE1..BE2); pre-flight audit flagging missing continuous assessment scores before submission windows.
5. MoE/NEMIS/KRA export generators
   - Strict-schema CSV/JSON exports, PDF audit books, KRA eTIMS payload webhooks; immutable export_audit_logs per event.
6. Telegram/WhatsApp telemetry alerts
   - Alerts when kitchen dispatch exceeds expected consumption ratio by >10%.
7. KDPA 2019 privacy + immutable audit
   - pgcrypto field-level encryption for parent phone/birth cert; audit log on every CSV/PDF export.

## Rules
- Additive migrations only; never alter/drop existing columns.
- Isolated modules under backend/internal/* and frontend/src/modules/*.
- Graceful degradation: offline IndexedDB outbox fallback; never hard-crash.
- Tenant isolation via TenantTxMiddleware; public routes keep h.database fallback.
- Run go build ./..., go vet ./..., go test -race ./... after each module.
- Frontend: npx tsc --noEmit.

## Deliverable
All modules implemented, tests green, committed per module, pushed to main.
