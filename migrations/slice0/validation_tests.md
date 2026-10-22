// Validation Test Specifications for Slice 0
// These tests must pass before proceeding to Slice 1

// Test 1: Cross-tenant leak test
// For every tenant table T:
//   INSERT into T as tenant_a
//   SET LOCAL app.current_tenant_id = 'tenant_b'
//   SELECT from T -> must return 0 rows
//
// Tables to test:
//   users, tenant_memberships, refresh_tokens, devices, otp_challenges,
//   guardian_claim_codes, audit_events, outbox

// Test 2: Pooled-connection tenant-context test
//   Connection 1: SET LOCAL app.current_tenant_id = 'tenant_a'; INSERT into schools
//   Connection 2 (same pool): SET LOCAL app.current_tenant_id = 'tenant_b'; SELECT from schools
//   Must NOT see tenant_a's data

// Test 3: Audit append-only test
//   INSERT into audit_events
//   UPDATE audit_events -> must fail (no UPDATE permission for app role)
//   DELETE from audit_events -> must fail (no DELETE permission for app role)

// Test 4: RLS policy enforcement
//   SET LOCAL app.current_tenant_id = 'tenant_a'
//   INSERT into tenant_memberships with tenant_id = 'tenant_b' -> must fail
//   INSERT into tenant_memberships with tenant_id = 'tenant_a' -> must succeed

// Test 5: JWT validation
//   Valid token -> returns claims
//   Expired token -> returns error
//   Tampered token -> returns error
//   Token without tenant_id -> routes to school picker

// Test 6: OTP flow
//   Request OTP -> creates challenge with 5-minute expiry
//   Verify OTP (correct) -> marks challenge as used
//   Verify OTP (wrong) -> increments attempts, max 5 attempts
//   Verify OTP (expired) -> returns expired error

// Test 7: Password hashing
//   HashPassword -> returns salt:hash format
//   VerifyPassword (correct) -> returns true
//   VerifyPassword (wrong) -> returns false

// Test 8: Phone normalisation
//   "0712345678" -> "254712345678"
//   "254712345678" -> "254712345678"
//   "+254712345678" -> "254712345678"
//   "712345678" -> "254712345678"

// Test 9: Tenant switch
//   User with memberships in tenant_a and tenant_b
//   Switch to tenant_b -> returns new token scoped to tenant_b
//   Switch to tenant_c (no membership) -> returns 403
