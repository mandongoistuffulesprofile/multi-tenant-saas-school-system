import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Marks captured on the offline rubric screen stay on the device. The screen used
// to POST them to a route the API does not have, then swallow the 404 — so the
// test asserts both halves of the replacement: nothing is sent, and the clerk is
// told the marks are local.
const harness = vi.hoisted(() => ({
  post: vi.fn(),
  getPendingAssessments: vi.fn(),
  saveAssessmentOffline: vi.fn(),
  markAssessmentsSynced: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: { get: vi.fn(), post: harness.post, put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock("../services/assessmentDb", () => ({
  saveAssessmentOffline: harness.saveAssessmentOffline,
  getPendingAssessments: harness.getPendingAssessments,
  markAssessmentsSynced: harness.markAssessmentsSynced,
}));

import CBCRubricAssessment from "../components/CBCRubricAssessment";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  harness.post.mockReset();
  harness.getPendingAssessments.mockReset();
  harness.saveAssessmentOffline.mockReset();
  harness.markAssessmentsSynced.mockReset();
  harness.getPendingAssessments.mockResolvedValue([
    { id: "local-1", studentId: "learner-1", subStrandId: "ss-1", score: 3, ratingCode: "ME" },
    { id: "local-2", studentId: "learner-2", subStrandId: "ss-1", score: 2, ratingCode: "AE" },
  ]);
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
    root.render(
      <CBCRubricAssessment
        tenantId="tenant-1"
        subStrand={{ id: "ss-1", name: "Counting" }}
        learners={[{ id: "learner-1", name: "Amina Wanjiru", admissionNumber: "ADM-1" }]}
      />,
    );
    await Promise.resolve();
  });
}

describe("offline CBC rubric marks", () => {
  it("labels queued marks as local and explains that sync is not available", async () => {
    await render();

    const button = Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent || "").includes("2 changes saved on this device"),
    );
    expect(button, "no local-marks control").toBeTruthy();
    expect(container.textContent || "").toContain("Online sync not available yet");

    await act(async () => {
      (button as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(container.textContent || "").toContain("Online sync is not available yet.");
    expect(container.textContent || "").toContain("2 changes are saved on this device");
    // Nothing was sent, so there is no 404 to swallow.
    expect(harness.post).not.toHaveBeenCalled();
    expect(harness.markAssessmentsSynced).not.toHaveBeenCalled();
  });

  it("uses the singular when one change is waiting", async () => {
    harness.getPendingAssessments.mockResolvedValue([
      { id: "local-1", studentId: "learner-1", subStrandId: "ss-1", score: 3, ratingCode: "ME" },
    ]);
    await render();

    const button = Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent || "").includes("1 change saved on this device"),
    );
    await act(async () => {
      (button as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(container.textContent || "").toContain("1 change is saved on this device");
    expect(container.textContent || "").not.toContain("1 change are saved");
  });

  it("still saves a rubric choice on the device", async () => {
    await render();

    const meButton = Array.from(container.querySelectorAll("button")).find(
      (b) => (b.textContent || "").trim() === "ME",
    );
    await act(async () => {
      (meButton as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(harness.saveAssessmentOffline).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1", studentId: "learner-1", ratingCode: "ME", score: 3 }),
    );
    expect(harness.post).not.toHaveBeenCalled();
  });
});
