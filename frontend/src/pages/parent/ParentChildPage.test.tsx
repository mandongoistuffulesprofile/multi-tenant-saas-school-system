import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The child view is only useful if the rows it is handed reach the tables, so
// this renders it against the exact JSON the parent-facing endpoints return and
// checks what a parent would actually read on screen.
const harness = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("../../lib/api", () => ({
  api: { get: harness.get, post: vi.fn(), put: vi.fn() },
}));

vi.mock("../../lib/authStore", () => {
  const useAuthStore = Object.assign(
    () => ({ tenantId: "tenant-1", roles: ["GUARDIAN"], userId: "guardian-user-1" }),
    { getState: () => ({ tenantId: "tenant-1", roles: ["GUARDIAN"], userId: "guardian-user-1" }) },
  );
  return { useAuthStore };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import ParentChildPage from "./ParentChildPage";

const linkedLearners = [
  {
    learner_id: "l-1",
    first_name: "Amina",
    last_name: "Wanjiru",
    admission_number: "ADM-001",
    grade_label: "Grade 5",
  },
];

// `/parent/attendance` returns flat display strings, already joined for the UI.
const parentAttendance = [
  { date: "2026-05-04", learner: "Amina Wanjiru", class_name: "Grade 5", status: "PRESENT" },
  { date: "2026-05-05", learner: "Amina Wanjiru", class_name: "Grade 5", status: "LATE" },
  // A sibling's row: the view must only show the selected child.
  { date: "2026-05-06", learner: "Brian Otieno", class_name: "Grade 4", status: "ABSENT" },
];

const reportCards = [
  {
    card_id: "c-1",
    learner_id: "l-1",
    card_number: "RC-001",
    percentage: 78,
    overall_grade: "ME1",
    status: "PUBLISHED",
  },
  // A sibling's card: /reports/cards is not filtered to one learner.
  {
    card_id: "c-2",
    learner_id: "l-2",
    card_number: "RC-002",
    percentage: 55,
    overall_grade: "AE2",
    status: "PUBLISHED",
  },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  harness.get.mockImplementation(async (url: string) => {
    if (url === "/me/linked-learners") return { data: linkedLearners };
    if (url === "/parent/attendance") return { data: parentAttendance };
    if (url === "/reports/cards") return { data: reportCards };
    return { data: [] };
  });
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
    root.render(<ParentChildPage />);
  });
  // linked-learners → selected child → attendance + cards.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("parent child view", () => {
  it("shows the selected child's attendance and report cards", async () => {
    await render();

    const text = container.textContent || "";
    expect(text).toContain("Amina Wanjiru");
    expect(text).toContain("ADM-001");

    // Attendance table rows.
    expect(text).toContain("2026-05-04");
    expect(text).toContain("PRESENT");
    expect(text).toContain("LATE");
    expect(text).toContain("Grade 5");

    // Report card row, rendered from the card fields the endpoint returns.
    expect(text).toContain("RC-001");
    expect(text).toContain("78");
    expect(text).toContain("ME1");
    expect(text).toContain("PUBLISHED");

    expect(harness.get).toHaveBeenCalledWith("/parent/attendance");
    expect(harness.get).toHaveBeenCalledWith("/reports/cards");
  });

  it("does not mix a sibling's attendance into the selected child's table", async () => {
    await render();

    const text = container.textContent || "";
    expect(text).not.toContain("Brian Otieno");
    expect(text).not.toContain("ABSENT");
    expect(text).not.toContain("2026-05-06");
    expect(text).not.toContain("RC-002");
    expect(text).not.toContain("AE2");
  });
});
