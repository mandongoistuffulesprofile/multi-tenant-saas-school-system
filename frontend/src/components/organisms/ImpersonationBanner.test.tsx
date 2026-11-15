import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// The platform desk starts a support session and records it in sessionStorage; the
// banner has to read that same place, and ending it must reach the server so the
// session stops being usable instead of running until it expires.
const harness = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
const auth = vi.hoisted(() => ({ clearAuth: vi.fn() }));

vi.mock("../../lib/api", () => ({ api: harness }));
vi.mock("../../lib/authStore", () => ({
  useAuthStore: (selector: (s: { clearAuth: () => void }) => unknown) =>
    selector({ clearAuth: auth.clearAuth }),
}));

import ImpersonationBanner from "./ImpersonationBanner";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  harness.post.mockResolvedValue({ data: { revoked: true } });
  auth.clearAuth.mockReset();
  sessionStorage.clear();
  localStorage.clear();
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

function startSession(expiresAt = "2026-11-15T11:00:00Z") {
  sessionStorage.setItem("imp_school", "Kitui Central Primary");
  sessionStorage.setItem("imp_session_id", "imp-session-1");
  sessionStorage.setItem("imp_expires_at", expiresAt);
}

async function render() {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route path="/dashboard" element={<ImpersonationBanner />} />
          <Route path="/platform/operations" element={<p>Platform console</p>} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

function endButton() {
  return Array.from(container.querySelectorAll("button")).find((b) =>
    (b.textContent || "").includes("End impersonation"),
  ) as HTMLButtonElement | undefined;
}

it("stays out of the way when there is no support session", async () => {
  await render();
  expect(container.textContent || "").toBe("");
});

it("shows the school an operator is inspecting, and when it runs out", async () => {
  startSession();
  await render();

  const text = container.textContent || "";
  expect(text).toContain("AUDIT SESSION");
  expect(text).toContain("Kitui Central Primary");
  expect(text).toContain("until");
  expect(endButton()).toBeDefined();
});

it("ends the session on the server, then clears it and returns to the console", async () => {
  startSession();
  await render();

  await act(async () => {
    endButton()!.click();
  });
  await act(async () => {
    await Promise.resolve();
  });

  expect(harness.post).toHaveBeenCalledWith("/platform/impersonations/imp-session-1/end");
  // Nothing left behind for the next page to read as an active session.
  expect(sessionStorage.getItem("imp_school")).toBeNull();
  expect(sessionStorage.getItem("imp_session_id")).toBeNull();
  expect(sessionStorage.getItem("imp_expires_at")).toBeNull();
  expect(auth.clearAuth).toHaveBeenCalled();
  expect(container.textContent || "").toContain("Platform console");
});

it("keeps the session on screen when the server refuses to end it", async () => {
  startSession();
  harness.post.mockRejectedValue({
    response: { status: 500, data: { message: "Imeshindikana kwenye seva." } },
  });
  await render();

  await act(async () => {
    endButton()!.click();
  });
  await act(async () => {
    await Promise.resolve();
  });

  expect(container.textContent || "").toContain("Imeshindikana kwenye seva.");
  // Still an active session, so the keys and the banner stay.
  expect(sessionStorage.getItem("imp_session_id")).toBe("imp-session-1");
  expect(container.textContent || "").toContain("Kitui Central Primary");

  // And the button can be tried again.
  expect(endButton()?.disabled).toBe(false);
});

it("treats a session the server no longer knows as over", async () => {
  startSession();
  harness.post.mockRejectedValue({
    response: { status: 404, data: { message: "Impersonation session not found or already ended" } },
  });
  await render();

  await act(async () => {
    endButton()!.click();
  });
  await act(async () => {
    await Promise.resolve();
  });

  expect(sessionStorage.getItem("imp_session_id")).toBeNull();
  expect(container.textContent || "").toContain("Platform console");
});
