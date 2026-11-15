import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The gate terminal is the one screen a clerk stands in front of all morning, so
// what it does with each answer from POST /gate/scan matters more than how it
// looks: a valid passcode has to open, a refusal has to say so, and a dead
// connection must not look like a granted entry.
const harness = vi.hoisted(() => ({
  post: vi.fn(),
  toast: vi.fn(),
  clearAuth: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: { get: vi.fn(), post: harness.post, put: vi.fn() },
}));

vi.mock("../lib/authStore", () => ({
  useAuthStore: () => ({
    clearAuth: harness.clearAuth,
    tenantId: "tenant-1",
    userId: "clerk-1",
    roles: ["TEACHER"],
  }),
}));

vi.mock("../components/toast/ToastProvider", () => ({
  useToast: () => ({ toast: harness.toast }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key,
  }),
}));

import KioskPage from "./KioskPage";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  harness.post.mockReset();
  harness.toast.mockReset();
  harness.clearAuth.mockReset();
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
      <MemoryRouter>
        <KioskPage />
      </MemoryRouter>,
    );
  });
}

function typePasscode(value: string) {
  const input = container.querySelector('input[type="password"]') as HTMLInputElement;
  expect(input).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonByText(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (b) => (b.textContent || "").trim() === label,
  );
  expect(button).toBeDefined();
  return button as HTMLButtonElement;
}

async function scan(passcode = "481516") {
  await act(async () => {
    typePasscode(passcode);
  });
  await act(async () => {
    buttonByText("Verify").click();
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("gate kiosk", () => {
  it("opens the barrier for a valid passcode and offers the next scan", async () => {
    harness.post.mockResolvedValue({ data: { verified: true } });
    await render();

    await scan("481516");

    expect(harness.post).toHaveBeenCalledWith("/gate/scan", { passcode: "481516" });
    const text = container.textContent || "";
    expect(text).toContain("Access granted");
    expect(text).toContain("Welcome, staff member. Proceed to entry.");
    expect(text).toContain("Scan another badge");
    expect(harness.toast).toHaveBeenCalledWith("Access granted", { type: "success" });

    // The clerk can clear the screen for the next learner without reloading.
    await act(async () => {
      buttonByText("Scan another badge").click();
    });
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
  });

  it("says the passcode was refused and does not look like a granted entry", async () => {
    harness.post.mockResolvedValue({ data: { verified: false } });
    await render();

    await scan("000000");

    const text = container.textContent || "";
    expect(text).toContain("Access denied");
    expect(text).not.toContain("Access granted");
    expect(text).not.toContain("Welcome, staff member");
    // The passcode stays on screen so the clerk can correct a typo.
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    expect(harness.toast).not.toHaveBeenCalled();
  });

  it("shows the server's reason when the terminal passcode is rejected", async () => {
    harness.post.mockRejectedValue({
      response: { status: 403, data: { message: "Invalid terminal passcode" } },
    });
    await render();

    await scan("wrong");

    const text = container.textContent || "";
    expect(text).toContain("Invalid terminal passcode");
    expect(text).not.toContain("Access granted");
    // Failure must not leave the terminal stuck in "Scanning…".
    expect(buttonByText("Verify").disabled).toBe(false);
  });

  it("reports a failed scan when the terminal is offline", async () => {
    harness.post.mockRejectedValue(new Error("Network Error"));
    await render();

    await scan("481516");

    const text = container.textContent || "";
    expect(text).toContain("Scan failed");
    expect(text).not.toContain("Access granted");
    expect(text).not.toContain("Access denied");
    expect(harness.post).toHaveBeenCalledTimes(1);
  });

  it("signs the clerk out of the terminal", async () => {
    await render();

    await act(async () => {
      buttonByText("Sign out").click();
    });

    expect(harness.clearAuth).toHaveBeenCalledTimes(1);
  });
});
