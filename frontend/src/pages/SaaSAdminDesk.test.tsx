import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
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
    county: "Machakos",
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

function setValue(container: HTMLDivElement, placeholder: string, value: string) {
  const input = container.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement;
  expect(input).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function SetupStub() {
  const { tenantId } = useParams();
  return <p>Setup wizard for {tenantId}</p>;
}

async function renderAtDeskWithSetupRoute() {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/platform/desk"]}>
        <Routes>
          <Route path="/platform/desk" element={<SaaSAdminDesk />} />
          <Route path="/platform/tenants/:tenantId/setup" element={<SetupStub />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function render() {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <SaaSAdminDesk />
      </MemoryRouter>,
    );
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

    // County is shown from the registry payload rather than left blank.
    expect(text).toContain("Machakos");

    // The type column reflects the stored school_type instead of labelling every
    // school "Comprehensive" and inventing a boarding arrangement.
    const rows = Array.from(container.querySelectorAll("tbody tr")).map((r) => r.textContent || "");
    expect(rows[0]).toContain("Comprehensive");
    expect(rows[1]).toContain("Private");
    expect(text).not.toContain("Kutwa Pekee");
    expect(text).not.toContain("Bweni na Kutwa");

    // Each row offers the setup wizard, which owns the details this table and
    // the create form cannot write themselves.
    const setupLinks = Array.from(container.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(setupLinks).toContain("/platform/tenants/t-1/setup");
    expect(setupLinks).toContain("/platform/tenants/t-2/setup");
  });

  it("no longer asks for details only the setup wizard can store", async () => {
    await render();

    await act(async () => {
      container.querySelector("button")?.click();
    });

    const modal = container.querySelector("form")!;
    expect(modal).not.toBeNull();

    // MoE number, sub-county and paybill had no column behind CreateTenant, so
    // the form no longer asks for them; the setup wizard records them instead.
    const placeholders = Array.from(modal.querySelectorAll("input")).map((i) =>
      i.getAttribute("placeholder"),
    );
    expect(placeholders).not.toContain("MoE/PRI/2026/...");
    expect(placeholders).not.toContain("Mfano: Mwingi North");
    expect(placeholders).not.toContain("522123");
    expect(modal.textContent || "").not.toContain("Sub-County");
    expect(modal.textContent || "").not.toContain("Safaricom Paybill");

    // Neither the boarding arrangement nor a per-school fee is stored by the
    // endpoint, so the form no longer pretends to set them.
    expect(modal.textContent || "").not.toContain("Makazi ya Wanafunzi");
    expect(modal.textContent || "").not.toContain("Ada ya SaaS kwa Muhula");
    expect(modal.querySelector('input[type="number"]')).toBeNull();

    // The workflow is still reachable, and the form says where the rest lives.
    expect(modal.textContent || "").toContain("Setup ya shule");
    expect(modal.textContent || "").toContain("STANDARD");
    expect(modal.textContent || "").toContain("Plans");
  });

  it("refuses to submit until the fields CreateTenant requires are filled", async () => {
    await render();

    await act(async () => {
      container.querySelector('button')?.click();
    });
    const form = container.querySelector('form');
    expect(form).not.toBeNull();

    // Dispatch the submit directly: the browser's own `required` check would
    // stop the event before our handler runs, which is not what is under test.
    await act(async () => {
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(harness.post).not.toHaveBeenCalled();
    const text = container.textContent || '';
    expect(text).toContain('Jina la shule ni lazima.');
    expect(text).toContain('Subdomain ni lazima.');
    expect(text).toContain('Barua pepe ya msimamizi ni lazima.');
    expect(text).toContain('Weka nambari ya simu halali');
  });

  it("sends the school type and head teacher the form collected", async () => {
    await render();

    await act(async () => {
      container.querySelector('button')?.click();
    });

    const type = (placeholder: string, value: string) => {
      const input = container.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement;
      expect(input).not.toBeNull();
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };

    await act(async () => {
      type('Mfano: MANDONGOI COMPREHENSIVE SCHOOL', 'Mandongo I Primary');
      type('Mfano: Joel Maundu', 'Joel Maundu');
      type('0712345678', '0712 345 678');
      type('admin@newschool.ac.ke', 'Admin@MandongoI.ac.ke');
    });

    await act(async () => {
      const form = container.querySelector('form')!;
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(harness.post).toHaveBeenCalledTimes(1);
    const [url, body] = harness.post.mock.calls[0];
    expect(url).toBe('/platform/tenants');
    expect(body).toMatchObject({
      school_name: 'Mandongo I Primary',
      subdomain: 'mandongo-i-primary',
      admin_email: 'admin@mandongoi.ac.ke',
      admin_phone: '254712345678',
      // The "Public Comprehensive" default has to reach the API, otherwise the
      // school is stored as PRIVATE/CUSTOM regardless of the choice.
      school_type: 'PUBLIC',
      funding_mode: 'CAPITATION',
      admin_full_name: 'Joel Maundu',
      plan_code: 'STANDARD',
    });
  });

  it("suspends and reinstates a school from its licence chip", async () => {
    // The desk re-reads the registry after the write, so the fake platform has to
    // reflect the change it accepted, as the real one does.
    let current = tenants.map((t) => ({ ...t }));
    harness.get.mockImplementation(async () => ({ data: current.map((t) => ({ ...t })) }));
    harness.put.mockImplementation(async (_url: string, body: { status: string }) => {
      current = current.map((t) => (t.tenant_id === "t-1" ? { ...t, status: body.status } : t));
      return { data: {} };
    });

    await render();

    const chip = (label: string) =>
      Array.from(container.querySelectorAll("button")).find((b) =>
        (b.textContent || "").includes(label),
      ) as HTMLButtonElement | undefined;

    // Only the ACTIVE school's chip offers suspension.
    const suspend = chip("Leseni Hai");
    expect(suspend).toBeDefined();
    await act(async () => {
      suspend!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(harness.put).toHaveBeenCalledWith("/platform/tenants/t-1/status", {
      status: "SUSPENDED",
      expected_status: "ACTIVE",
    });
    // The row has to follow the platform, not keep showing the old licence.
    expect(chip("Leseni Hai")).toBeUndefined();
    expect(chip("Imesimamishwa")).toBeDefined();

    await act(async () => {
      chip("Imesimamishwa")!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(harness.put).toHaveBeenLastCalledWith("/platform/tenants/t-1/status", {
      status: "ACTIVE",
      expected_status: "SUSPENDED",
    });
    expect(chip("Leseni Hai")).toBeDefined();
  });

  it("re-reads the registry after a status change instead of trusting its own copy", async () => {
    await render();

    const chip = (label: string) =>
      Array.from(container.querySelectorAll("button")).find((b) =>
        (b.textContent || "").includes(label),
      ) as HTMLButtonElement | undefined;

    // After our write, the registry answers with what the platform currently
    // holds: the school was reinstated by a second operator, and its name was
    // corrected at the same time. That copy must win, not our optimistic one.
    harness.get.mockResolvedValue({
      data: [
        { ...tenants[0], school_name: "Kitui Central Primary (verified)", status: "ACTIVE" },
        tenants[1],
      ],
    });

    await act(async () => {
      chip("Leseni Hai")!.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(harness.put).toHaveBeenCalledWith("/platform/tenants/t-1/status", {
      status: "SUSPENDED",
      expected_status: "ACTIVE",
    });
    // One read for the first paint, one after the change.
    expect(harness.get.mock.calls.filter(([url]) => url === "/platform/tenants")).toHaveLength(2);

    const firstRow = container.querySelectorAll("tbody tr")[0].textContent || "";
    expect(firstRow).toContain("Kitui Central Primary (verified)");
    expect(firstRow).toContain("Leseni Hai");
    expect(firstRow).not.toContain("Imesimamishwa");
  });

  describe("impersonation", () => {
    const originalLocation = window.location;

    beforeEach(() => {
      // jsdom refuses real navigation, and the desk leaves the SPA with
      // window.location.href, so stand in a replaceable location object.
      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: { href: "/platform/desk" },
      });
      sessionStorage.clear();
    });

    afterEach(() => {
      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: originalLocation,
      });
      vi.unstubAllGlobals();
    });

    const loginAs = () =>
      Array.from(container.querySelectorAll("button")).find((b) =>
        (b.textContent || "").includes("Login As"),
      ) as HTMLButtonElement;

    const reasonField = () => container.querySelector("#imp-reason") as HTMLTextAreaElement | null;

    const typeReason = (value: string) => {
      const field = reasonField()!;
      expect(field).not.toBeNull();
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    };

    const submitReason = () => {
      const form = reasonField()!.closest("form")!;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    };

    const clickButton = (label: string) =>
      Array.from(container.querySelectorAll("button")).find((b) =>
        (b.textContent || "").includes(label),
      ) as HTMLButtonElement;

    it("asks for the audit reason in a form, then records it and opens the school", async () => {
      harness.post.mockResolvedValue({
        data: {
          session_id: "imp-session-1",
          expires_at: "2026-11-15T11:00:00Z",
          school_name: "Kitui Central Primary",
        },
      });

      await render();
      // Opening the school asks first, rather than prompting the browser.
      await act(async () => {
        loginAs().click();
      });
      expect(reasonField()).not.toBeNull();
      expect(container.textContent || "").toContain("Kitui Central Primary");

      await act(async () => {
        typeReason("TICKET-431: fees balance query");
      });
      await act(async () => {
        submitReason();
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(harness.post).toHaveBeenCalledWith("/platform/impersonations", {
        tenant_id: "t-1",
        reason: "TICKET-431: fees balance query",
      });
      // The support session travels with the operator into the tenant console.
      expect(sessionStorage.getItem("imp_school")).toBe("Kitui Central Primary");
      expect(sessionStorage.getItem("imp_session_id")).toBe("imp-session-1");
      expect(sessionStorage.getItem("imp_expires_at")).toBe("2026-11-15T11:00:00Z");
      expect(container.textContent || "").toContain("Session ya ukaguzi");
      expect(window.location.href).toBe("/dashboard");
    });

    it("says what is wrong with the reason next to the field", async () => {
      await render();
      await act(async () => {
        loginAs().click();
      });

      // Empty: the note is required.
      await act(async () => {
        submitReason();
      });
      expect(container.textContent || "").toContain("Sababu ya kuingia ni lazima");
      expect(reasonField()!.getAttribute("aria-invalid")).toBe("true");
      expect(harness.post).not.toHaveBeenCalled();

      // Too short to be a useful audit trail.
      await act(async () => {
        typeReason("why");
      });
      await act(async () => {
        submitReason();
      });
      expect(container.textContent || "").toContain("herufi 10 au zaidi");
      expect(harness.post).not.toHaveBeenCalled();
      expect(window.location.href).toBe("/platform/desk");

      // Typing again clears the complaint; the form is still open with the text.
      await act(async () => {
        typeReason("TICKET-431: parent cannot see the fees balance");
      });
      expect(container.textContent || "").not.toContain("herufi 10 au zaidi");
      expect(reasonField()!.value).toBe("TICKET-431: parent cannot see the fees balance");
    });

    it("closes the form without starting anything when the operator cancels", async () => {
      await render();
      await act(async () => {
        loginAs().click();
      });
      await act(async () => {
        typeReason("TICKET-431: fees balance query");
      });
      await act(async () => {
        clickButton("Ghairi").click();
      });

      expect(reasonField()).toBeNull();
      expect(harness.post).not.toHaveBeenCalled();
      expect(sessionStorage.getItem("imp_session_id")).toBeNull();
      expect(window.location.href).toBe("/platform/desk");
    });

    it("keeps the form and its note when the platform refuses the session", async () => {
      harness.post.mockRejectedValue({
        response: { status: 403, data: { message: "Reason must be at least 10 characters" } },
      });

      await render();
      await act(async () => {
        loginAs().click();
      });
      await act(async () => {
        typeReason("why exactly");
      });
      await act(async () => {
        submitReason();
      });
      await act(async () => {
        await Promise.resolve();
      });

      // The server's own wording, in the form, with the note kept for a retry.
      expect(container.textContent || "").toContain("Reason must be at least 10 characters");
      expect(reasonField()!.value).toBe("why exactly");
      expect(reasonField()!.disabled).toBe(false);
      // A refused session must not leave one behind in storage.
      expect(sessionStorage.getItem("imp_session_id")).toBeNull();
      expect(window.location.href).toBe("/platform/desk");
    });
  });

  it("re-applies a refused licence change to the state the platform now shows", async () => {
    // The clerk saw GRACE_PERIOD and reinstates; another operator suspended the
    // school first, so the platform answers 409 and the row refreshes as SUSPENDED.
    let reads = 0;
    harness.get.mockImplementation(async () => {
      reads += 1;
      return {
        data: [
          {
            ...tenants[0],
            status: reads === 1 ? "GRACE_PERIOD" : reads === 2 ? "SUSPENDED" : "ACTIVE",
          },
          tenants[1],
        ],
      };
    });
    harness.put.mockRejectedValueOnce({
      response: {
        status: 409,
        data: { message: "Another operator changed this school to SUSPENDED. Reload and try again." },
      },
    });

    await render();

    const chip = (label: string) =>
      Array.from(container.querySelectorAll("button")).find((b) =>
        (b.textContent || "").includes(label),
      ) as HTMLButtonElement | undefined;

    await act(async () => {
      chip("Grace Period")!.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // The intent survives the refusal, with a retry against the refreshed row.
    const retry = chip("Jaribu tena: Hudumia");
    expect(retry).toBeDefined();
    expect(container.textContent || "").toContain("changed this school to SUSPENDED");

    await act(async () => {
      retry!.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(harness.put).toHaveBeenLastCalledWith("/platform/tenants/t-1/status", {
      status: "ACTIVE",
      expected_status: "SUSPENDED",
    });
    expect(chip("Leseni Hai")).toBeDefined();
    // The panel goes away once the change lands.
    expect(container.textContent || "").not.toContain("Jaribu tena:");
  });

  it("does not resend a change the platform already put in force", async () => {
    // The school is already suspended when the clerk's suspended change is
    // refused: the intent is satisfied, so retrying must not hit the API again.
    let reads = 0;
    harness.get.mockImplementation(async () => {
      reads += 1;
      return {
        data: [
          { ...tenants[0], status: reads === 1 ? "ACTIVE" : "SUSPENDED" },
          tenants[1],
        ],
      };
    });
    harness.put.mockRejectedValueOnce({
      response: {
        status: 409,
        data: {
          message:
            "This school is already SUSPENDED — another operator changed it before you. Reload to see the current state.",
        },
      },
    });

    await render();

    const chip = (label: string) =>
      Array.from(container.querySelectorAll("button")).find((b) =>
        (b.textContent || "").includes(label),
      ) as HTMLButtonElement | undefined;

    await act(async () => {
      chip("Leseni Hai")!.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      chip("Jaribu tena: Simamisha")!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // One attempt only, and the row already shows the outcome the clerk wanted.
    expect(harness.put).toHaveBeenCalledTimes(1);
    expect(container.textContent || "").toContain("already SUSPENDED");
    expect(chip("Imesimamishwa")).toBeDefined();
    expect(container.textContent || "").not.toContain("Jaribu tena:");
  });

  it("shows why a licence change was refused when another operator got there first", async () => {
    // Another clerk suspended this school between our read and our write.
    harness.put.mockRejectedValue({
      response: {
        status: 409,
        data: {
          code: "STATUS_CHANGED",
          message:
            "This school is already SUSPENDED — another operator changed it before you. Reload to see the current state.",
        },
      },
    });

    await render();

    const chip = Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent || "").includes("Leseni Hai"),
    ) as HTMLButtonElement;
    await act(async () => {
      chip.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // The reason, not a generic failure: the clerk has to know the school is
    // suspended and that their screen was out of date.
    expect(container.textContent || "").toContain("already SUSPENDED");
    expect(container.textContent || "").not.toContain("Imeshindikana kubadilisha hali ya shule");

    // And the screen is re-read, so the row stops offering a change already made.
    expect(harness.get.mock.calls.filter(([url]) => url === "/platform/tenants")).toHaveLength(2);
  });

  it("keeps the row's old status when the platform rejects the change", async () => {
    harness.put.mockRejectedValue({ response: { status: 403, data: { message: "Forbidden" } } });
    await render();

    const chip = Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent || "").includes("Leseni Hai"),
    ) as HTMLButtonElement;
    await act(async () => {
      chip.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent || "").toContain("Imeshindikana kubadilisha hali ya shule");
    // Row-scoped: the second fixture school is suspended from the start.
    const firstRow = container.querySelectorAll("tbody tr")[0];
    expect(firstRow.textContent || "").toContain("Kitui Central Primary");
    expect(firstRow.textContent || "").toContain("Leseni Hai");
    expect(firstRow.textContent || "").not.toContain("Imesimamishwa");
  });

  it("hands over the temporary password and then opens the new school's setup", async () => {
    harness.post.mockResolvedValue({
      data: {
        tenant_id: "new-school-1",
        school_name: "Mandongo I Primary",
        admin_email: "admin@mandongoi.ac.ke",
        temp_password: "tmp-9f8e7d6c",
      },
    });

    await renderAtDeskWithSetupRoute();

    await act(async () => {
      container.querySelector("button")?.click();
    });
    await act(async () => {
      setValue(container, "Mfano: MANDONGOI COMPREHENSIVE SCHOOL", "Mandongo I Primary");
      setValue(container, "Mfano: Joel Maundu", "Joel Maundu");
      setValue(container, "0712345678", "0712345678");
      setValue(container, "admin@newschool.ac.ke", "admin@mandongoi.ac.ke");
    });
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // The password comes back once, so it is shown with the school it belongs to.
    const panel = container.textContent || "";
    expect(panel).toContain("tmp-9f8e7d6c");
    expect(panel).toContain("Mandongo I Primary");
    expect(panel).toContain("mara moja");

    // It must not be parked in browser storage on the way through.
    const stored = [
      ...Object.keys(localStorage).map((k) => `${k}=${localStorage.getItem(k)}`),
      ...Object.keys(sessionStorage).map((k) => `${k}=${sessionStorage.getItem(k)}`),
    ].join("|");
    expect(stored).not.toContain("tmp-9f8e7d6c");

    // The operator continues into the wizard for the school just created.
    const continueButton = Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent || "").includes("Nenda kwenye Setup"),
    ) as HTMLButtonElement;
    expect(continueButton).toBeDefined();
    await act(async () => {
      continueButton.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent || "").toContain("Setup wizard for new-school-1");
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
