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
  // Optional audit payload (audit_events.new_values). Not every feed includes
  // it, so the action narratives below degrade to a plain sentence without it.
  details?: Record<string, unknown>;
  new_values?: Record<string, unknown>;
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

function detailNumber(row: AuditRow, key: string): number | null {
  const value = (row.details ?? row.new_values ?? {})[key];
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

// Actions whose names carry the whole meaning (a verb would be invented by
// verbFor) get a purpose-built sentence instead of a raw action code.
const ACTION_NARRATIVES: Record<string, (row: AuditRow) => string> = {
  ACADEMIC_ROLLOVER_APPLIED: (row) => {
    const promoted = detailNumber(row, "promoted");
    const graduating = detailNumber(row, "graduating");
    if (promoted === null && graduating === null) {
      return "ran the year-end rollover";
    }
    const parts = [
      promoted !== null ? `promoted ${plural(promoted, "learner")}` : null,
      graduating ? `graduated ${plural(graduating, "learner")}` : null,
    ].filter(Boolean);
    const summary = parts.length ? ` and ${parts.join(" and ")}` : "";
    return `ran the year-end rollover${summary}`;
  },
  LEARNER_IMPORT_APPLIED: (row) => {
    const created = detailNumber(row, "rows_created");
    const duplicates = detailNumber(row, "duplicates");
    const invalid = detailNumber(row, "invalid");
    const imported = created !== null
      ? `imported ${plural(created, "learner")} from a CSV file`
      : "imported learners from a CSV file";
    const skipped = (duplicates ?? 0) + (invalid ?? 0);
    if (skipped > 0) {
      return `${imported}, skipping ${plural(skipped, "row")} that were duplicated or invalid`;
    }
    return imported;
  },
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
  const when = row.accessed_at
    ? ` (${formatWhen(row.accessed_at)})`
    : "";

  const actionCode = (row.action || "").toUpperCase();
  const narrative = ACTION_NARRATIVES[actionCode];
  if (narrative) {
    return `${actor} ${narrative(row)}${when}`;
  }

  const verb = verbFor(row.action);
  const noun = nounFor(row.resource_type);
  const rest = row.resource_id ? ` #${String(row.resource_id).slice(0, 8)}` : "";
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