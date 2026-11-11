/**
 * Translates raw audit_log rows into plain-English sentences for non-technical
 * users (School Heads, staff). The raw `action` / `resource_type` / `resource_id`
 * columns never reach the UI directly — this is the boundary.
 *
 * Role-appropriate:
 *  - School Head / staff: operational impact ("Jane Doe updated the Term 2 fee
 *    structure").
 *  - SaaS super admin: same narrative plus diagnostics via the expandable drawer.
 */

interface AuditRow {
  action?: string;
  resource_type?: string;
  resource_id?: string;
  actor_name?: string;
  tenant_code?: string;
  tenant_id?: string;
  accessed_at?: string;
  ip_address?: string | null;
  user_agent?: string;
}

const RESOURCE_LABELS: Record<string, string> = {
  fee_structures: "fee structure",
  fee_categories: "fee category",
  invoices: "invoice",
  payments: "payment",
  payment_allocations: "payment allocation",
  learners: "learner record",
  attendance_marks: "attendance mark",
  assessment_results: "assessment result",
  assessment_events: "assessment event",
  guardians: "guardian record",
  tenant_memberships: "school membership",
  schools: "school profile",
  staff: "staff record",
  curriculum_versions: "curriculum version",
  comms_messages: "message",
  outbound_messages: "outbound message",
  sync_conflicts: "sync conflict",
  report_cards: "report card",
  consent_records: "consent record",
  api_keys: "API key",
  delegated_tokens: "delegated token",
  holding_tank: "unallocated payment",
  mpesa_raw_inbox: "M-Pesa callback",
};

const ACTION_VERBS: Record<string, string> = {
  create: "created",
  update: "updated",
  delete: "deleted",
  insert: "recorded",
  login: "signed in",
  logout: "signed out",
  switch: "switched school",
  activate: "activated",
  revoke: "revoked",
  resolve: "resolved",
  moderate: "moderated",
  reopen: "reopened",
  upsert: "updated",
  allocate: "allocated",
  match: "matched",
  flag: "flagged",
  publish: "published",
  submit: "submitted",
  verify: "verified",
  void: "voided",
};

function verbFor(action?: string): string {
  const a = (action || "").toLowerCase();
  for (const [k, v] of Object.entries(ACTION_VERBS)) {
    if (a.includes(k)) return v;
  }
  return a || "changed";
}

function nounFor(resourceType?: string): string {
  const rt = (resourceType || "").toLowerCase();
  return RESOURCE_LABELS[rt] || rt.replace(/_/g, " ") || "record";
}

/**
 * Produces a single narrative sentence, e.g.:
 *   "Jane Doe updated the Term 2 Tuition Fee Structure (Today at 10:14 AM)"
 */
export function formatAuditNarrative(row: AuditRow): string {
  const actor = row.actor_name || "A user";
  const verb = verbFor(row.action);
  const noun = nounFor(row.resource_type);
  const rest = row.resource_id ? ` #${String(row.resource_id).slice(0, 8)}` : "";
  const when = row.accessed_at
    ? ` (${formatWhen(row.accessed_at)})`
    : "";
  return `${actor} ${verb} the ${noun}${rest}${when}`;
}

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}

export type { AuditRow };