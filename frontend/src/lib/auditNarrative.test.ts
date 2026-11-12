import { describe, expect, it } from "vitest";
import { formatAuditNarrative } from "./auditNarrative";

const AT = new Date(Date.now() - 5 * 60 * 1000).toISOString();

describe("formatAuditNarrative action sentences", () => {
  it("renders an applied rollover with its counts", () => {
    const sentence = formatAuditNarrative({
      action: "ACADEMIC_ROLLOVER_APPLIED",
      resource_type: "academic_years",
      actor_name: "Jane Doe",
      accessed_at: AT,
      details: { promoted: 10, graduating: 3 },
    });

    expect(sentence).toContain("Jane Doe ran the year-end rollover");
    expect(sentence).toContain("promoted 10 learners");
    expect(sentence).toContain("graduated 3 learners");
    expect(sentence).not.toContain("ACADEMIC_ROLLOVER_APPLIED");
  });

  it("renders a rollover even when the feed has no payload", () => {
    const sentence = formatAuditNarrative({
      action: "ACADEMIC_ROLLOVER_APPLIED",
      actor_name: "Jane Doe",
    });

    expect(sentence).toBe("Jane Doe ran the year-end rollover");
  });

  it("renders an applied import with created and skipped counts", () => {
    const sentence = formatAuditNarrative({
      action: "LEARNER_IMPORT_APPLIED",
      actor_name: "Jane Doe",
      details: { rows_created: 2, duplicates: 2, invalid: 2 },
    });

    expect(sentence).toContain("imported 2 learners from a CSV file");
    expect(sentence).toContain("skipping 4 rows");
    expect(sentence).not.toContain("LEARNER_IMPORT_APPLIED");
  });

  it("falls back to the generic sentence for unrelated actions", () => {
    const sentence = formatAuditNarrative({
      action: "update",
      resource_type: "fee_structures",
      actor_name: "Jane Doe",
    });

    expect(sentence).toBe("Jane Doe updated the fee structure");
  });
});
