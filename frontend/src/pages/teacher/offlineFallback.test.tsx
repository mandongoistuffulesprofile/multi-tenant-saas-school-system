import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The pages talk to the network through `api` and to the device cache through
// `lib/offline`. This test makes every request fail, exactly as it does with the
// radio off, and asserts the screens open from the saved copy instead of
// collapsing into an error or an empty list.
const harness = vi.hoisted(() => ({
  get: vi.fn(),
  readReference: vi.fn(),
  cacheReference: vi.fn(async () => {}),
  toast: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  api: { get: harness.get, post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock("../../lib/offline", () => ({
  cacheReference: harness.cacheReference,
  readReference: harness.readReference,
  recordOfflineAttendance: vi.fn(async () => {}),
  getAttendanceMarks: vi.fn(async () => []),
  recordOfflineAssessment: vi.fn(async () => {}),
  getAssessmentResults: vi.fn(async () => []),
  getDeviceId: () => "device-1",
}));

vi.mock("../../lib/authStore", () => {
  const useAuthStore = Object.assign(
    () => ({ tenantId: "tenant-1", roles: ["TEACHER"], userId: "user-1" }),
    { getState: () => ({ tenantId: "tenant-1", roles: ["TEACHER"], userId: "user-1" }) },
  );
  return { useAuthStore };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

vi.mock("../../components/toast/ToastProvider", () => ({
  useToast: () => ({ toast: harness.toast }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import AttendanceRegisterPage from "./AttendanceRegisterPage";
import GradingGridPage from "./GradingGridPage";

const CACHED_AT = "2026-11-14T08:12:00.000Z";

const registers = [
  {
    register_id: "reg-1",
    tenant_id: "tenant-1",
    class_group_id: "class-1",
    grade_id: "G5",
    stream_id: "",
    academic_year_id: "year-1",
    term_id: "term-1",
    register_date: "2026-05-04",
    session_type: "MORNING",
    status: "OPEN",
  },
];

const learners = [
  { learner_id: "l-1", first_name: "Amina", last_name: "Wanjiru", status: "ACTIVE" },
  { learner_id: "l-2", first_name: "Brian", last_name: "Otieno", status: "ACTIVE" },
];

const events = [
  {
    event_id: "ev-1",
    assessment_type: "SUMMATIVE",
    learning_area_name: "Mathematics",
    status: "OPEN",
  },
];

/** Serves the cache per key, or null for a key this device never saved. */
function cacheWith(entries: Record<string, unknown>) {
  harness.readReference.mockImplementation(async (_tenantId: string, key: string) => {
    if (!(key in entries)) return null;
    return { data: entries[key], cachedAt: CACHED_AT };
  });
}

let container: HTMLDivElement;
let root: Root;

async function render(Component: React.ComponentType) {
  await act(async () => {
    root.render(<Component />);
  });
  // Let the rejected request, the cache read and the state updates settle.
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  harness.get.mockRejectedValue(new Error("Network Error"));
  harness.readReference.mockResolvedValue(null);
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

describe("teacher marking screens without a connection", () => {
  it("opens attendance from the saved register and says it is offline", async () => {
    cacheWith({
      "attendance.registers": registers,
      "attendance.learners": learners,
    });

    await render(AttendanceRegisterPage);

    const text = container.textContent || "";
    expect(text).toContain("Offline — showing the register saved");
    expect(text).toContain("2026-05-04");
    expect(harness.readReference).toHaveBeenCalledWith("tenant-1", "attendance.registers");
    // The failed request is not shown as an error when a copy exists.
    expect(text).not.toContain("no saved attendance register yet");
  });

  it("opens grading from the saved events and roster instead of an empty state", async () => {
    cacheWith({
      "grading.events": events,
      "grading.learners": learners,
    });

    await render(GradingGridPage);

    const text = container.textContent || "";
    expect(text).toContain("Offline — showing assessment events saved");
    expect(text).toContain("SUMMATIVE");
    // The old behaviour said there were no events at all, hiding the outage.
    expect(text).not.toContain("No assessment events");
    expect(harness.readReference).toHaveBeenCalledWith("tenant-1", "grading.events");
  });

  it("asks the teacher to open each screen once online when nothing was saved", async () => {
    await render(AttendanceRegisterPage);

    const text = container.textContent || "";
    expect(text).toContain("no saved attendance register yet");
    expect(text).not.toContain("Offline — showing");
  });
});
