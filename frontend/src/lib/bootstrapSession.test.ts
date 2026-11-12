import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapSession, SessionBootstrapClient } from "./bootstrapSession";
import { useAuthStore } from "./authStore";

const SESSION_CACHE_KEY = "skulapp_session_v1";

const ME = {
  data: { user_id: "teacher-1", tenant_id: "school-a", roles: ["TEACHER"] },
};

function makeClient(overrides: Partial<SessionBootstrapClient> = {}): SessionBootstrapClient {
  return {
    me: vi.fn().mockResolvedValue(ME),
    refresh: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

describe("bootstrapSession", () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({
      token: null,
      refreshToken: null,
      userId: null,
      tenantId: null,
      roles: [],
      hydrated: false,
    });
  });

  it("refreshes once and retries /me when the access cookie has expired", async () => {
    const expired = { response: { status: 401 } };
    const me = vi
      .fn()
      .mockRejectedValueOnce(expired)
      .mockResolvedValueOnce(ME);
    const refresh = vi.fn().mockResolvedValue({});
    const clearAuth = vi.spyOn(useAuthStore.getState(), "clearAuth");

    await bootstrapSession({ me, refresh });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(me).toHaveBeenCalledTimes(2);
    expect(clearAuth).not.toHaveBeenCalled();
    expect(useAuthStore.getState().userId).toBe("teacher-1");
    expect(useAuthStore.getState().hydrated).toBe(true);

    clearAuth.mockRestore();
  });

  it("keeps the cached identity when the device is offline", async () => {
    localStorage.setItem(
      SESSION_CACHE_KEY,
      JSON.stringify({
        userId: "teacher-cached",
        tenantId: "school-a",
        roles: ["TEACHER"],
        saved_at: Date.now(),
      }),
    );
    const me = vi.fn().mockRejectedValue(new Error("Network Error"));
    const refresh = vi.fn();
    const clearAuth = vi.spyOn(useAuthStore.getState(), "clearAuth");

    await bootstrapSession({ me, refresh });

    expect(refresh).not.toHaveBeenCalled();
    expect(clearAuth).not.toHaveBeenCalled();
    expect(useAuthStore.getState().userId).toBe("teacher-cached");
    expect(useAuthStore.getState().roles).toEqual(["TEACHER"]);
    expect(useAuthStore.getState().hydrated).toBe(true);

    clearAuth.mockRestore();
  });

  it("does not sign out on a network failure while refreshing", async () => {
    localStorage.setItem(
      SESSION_CACHE_KEY,
      JSON.stringify({
        userId: "teacher-cached",
        tenantId: "school-a",
        roles: ["TEACHER"],
        saved_at: Date.now(),
      }),
    );
    const me = vi.fn().mockRejectedValue({ response: { status: 401 } });
    const refresh = vi.fn().mockRejectedValue(new Error("Network Error"));
    const clearAuth = vi.spyOn(useAuthStore.getState(), "clearAuth");

    await bootstrapSession({ me, refresh });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(clearAuth).not.toHaveBeenCalled();
    expect(useAuthStore.getState().userId).toBe("teacher-cached");
    expect(useAuthStore.getState().hydrated).toBe(true);

    clearAuth.mockRestore();
  });

  it("clears the session when the server explicitly rejects the refresh", async () => {
    const me = vi.fn().mockRejectedValue({ response: { status: 401 } });
    const refresh = vi.fn().mockRejectedValue({ response: { status: 401 } });

    await bootstrapSession({ me, refresh });

    expect(useAuthStore.getState().userId).toBeNull();
    expect(useAuthStore.getState().hydrated).toBe(true);
  });
});
