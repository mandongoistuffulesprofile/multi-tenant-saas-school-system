import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The desk normalises the platform tenant payload (tenant_id, school_name,
// subdomain, learners, status) into its own row model. This renders it against
// that payload so a field-renaming regression shows up as an empty table rather
// than reaching production unnoticed.
const harness = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));

vi.mock("../lib/api", () => ({ api: harness }));

import { SaaSAdminDesk } from "./SaaSAdminDesk";

const tenants = [
  {
    tenant_id: "t-1",
    school_name: "Kitui Central Primary",
    subdomain: "kitui-central",
    school_type: "PUBLIC",
    funding_mode: "CAPITATION",
    status: "ACTIVE",
    county: "Kitui",
    learners: 412,
    last_activity: "2026-11-14T09:00:00Z",
    onboarding_status: "COMPLETE",
    onboarding_step: "DONE",
  },
  {
    tenant_id: "t-2",
    school_name: "Mwingi Academy",
    subdomain: "mwingi-academy",
    school_type: "PRIVATE",
    funding_mode: "FEE_PAYING",
    status: "SUSPENDED",
    county: "Kitui",
    learners: 96,
    last_activity: "2026-10-02T11:30:00Z",
  },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  harness.get.mockResolvedValue({ data: tenants });
  harness.post.mockResolvedValue({ data: {} });
  harness.put.mockResolvedValue({ data: {} });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(<SaaSAdminDesk />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("platform admin desk", () => {
  it("lists every tenant from the platform registry", async () => {
    await render();

    const text = container.textContent || "";
    expect(harness.get).toHaveBeenCalledWith("/platform/tenants");

    expect(text).toContain("Kitui Central Primary");
    expect(text).toContain("kitui-central");
    expect(text).toContain("Mwingi Academy");
    expect(text).toContain("mwingi-academy");

    // Learner counts come from `learners`, not a `learner_count` field.
    expect(text).toContain("412");
    expect(text).toContain("96");

    // Status drives the licence chip.
    expect(text).toContain("Leseni Hai");
    expect(text).toContain("Imesimamishwa");
  });

  it("does not pretend a failed registry read is an empty one", async () => {
    harness.get.mockRejectedValue(new Error("Network Error"));

    await render();

    const text = container.textContent || "";
    expect(text).not.toContain("Kitui Central Primary");
    // The desk keeps its shell and targets above the table, so the screen is
    // still usable rather than replaced wholesale.
    expect(text).toContain("SaaS Admin Desk");
  });
});
