import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Two clerks can record a payment for the same learner at the same moment. When
// the backend refuses the second one with 409 INVOICE_BUSY nothing was committed,
// so the form has to say "try again" and repeat exactly what was typed — a generic
// "failed to record payment" would send the bursar hunting for a receipt that was
// never written, and retyping invites a different amount.
const harness = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: { get: harness.get, post: harness.post, put: vi.fn() },
}));

vi.mock("../components/toast/ToastProvider", () => ({
  useToast: () => ({ toast: harness.toast }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}));

import FinancePaymentsPage from "./FinancePaymentsPage";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  harness.get.mockReset();
  harness.post.mockReset();
  harness.toast.mockReset();
  harness.get.mockImplementation((url: string) => {
    if (url === "/finance/payments") return Promise.resolve({ data: [] });
    if (url === "/learners") {
      return Promise.resolve({
        data: [{ learner_id: "learner-1", first_name: "Amina", last_name: "Wanjiru", admission_number: "ADM-1" }],
      });
    }
    return Promise.resolve({ data: [] });
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
    root.render(
      <MemoryRouter>
        <FinancePaymentsPage />
      </MemoryRouter>,
    );
  });
}

function buttonByText(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((b) =>
    (b.textContent || "").includes(label),
  );
  expect(button, `no button containing "${label}"`).toBeTruthy();
  return button as HTMLButtonElement;
}

function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

async function fillAndSubmit(amount: string) {
  await act(async () => {
    buttonByText("Record Payment").click();
  });
  const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
  expect(dialog).not.toBeNull();

  await act(async () => {
    setValue(dialog.querySelector("select") as HTMLSelectElement, "learner-1");
    setValue(dialog.querySelector('input[type="number"]') as HTMLInputElement, amount);
  });
  await act(async () => {
    (dialog.querySelector("form") as HTMLFormElement).requestSubmit();
  });
  return dialog;
}

describe("payment recording under contention", () => {
  it("keeps the typed payment and offers a retry when the invoice is busy", async () => {
    harness.post.mockRejectedValueOnce({
      response: {
        status: 409,
        data: {
          code: "INVOICE_BUSY",
          message: "Another payment is being applied to this invoice. Try again in a moment.",
        },
      },
    });

    await render();
    const dialog = await fillAndSubmit("2500");

    // The refusal is explained in place, not as a generic toast failure.
    expect(dialog.textContent || "").toContain(
      "Another payment is being applied to this invoice. Try again in a moment.",
    );
    expect(harness.toast).not.toHaveBeenCalled();
    // The dialog stayed open with what the clerk typed.
    expect((dialog.querySelector('input[type="number"]') as HTMLInputElement).value).toBe("2500");
    expect((dialog.querySelector("select") as HTMLSelectElement).value).toBe("learner-1");
    expect(harness.post).toHaveBeenCalledTimes(1);

    // Retrying sends the same payment again and succeeds.
    harness.post.mockResolvedValueOnce({ data: { payment_id: "pay-1", allocated_amount: 2500 } });
    await act(async () => {
      buttonByText("Jaribu tena").click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(harness.post).toHaveBeenCalledTimes(2);
    expect(harness.post.mock.calls[1][1]).toMatchObject({
      learner_id: "learner-1",
      amount: 2500,
      source: "CASH",
    });
    expect(harness.toast).toHaveBeenCalledWith("Payment recorded", { type: "success" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("still reports an ordinary failure as an error", async () => {
    harness.post.mockRejectedValueOnce({
      response: { status: 500, data: { code: "DB_ERROR", message: "insert failed" } },
    });

    await render();
    const dialog = await fillAndSubmit("2500");

    expect(dialog.textContent || "").not.toContain("Jaribu tena");
    expect(harness.toast).toHaveBeenCalledWith("insert failed", { type: "error" });
  });
});
