import { beforeEach, describe, expect, it, vi } from "vitest";

const SESSION_CACHE_KEY = "skulapp_session_v1";
const DAY_MS = 24 * 60 * 60 * 1000;

function cachedSession(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    userId: "teacher-1",
    tenantId: "school-a",
    roles: ["TEACHER"],
    saved_at: Date.now(),
    ...overrides,
  });
}

describe("authStore cached session", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("restores the cached identity when the app is opened offline", async () => {
    localStorage.setItem(SESSION_CACHE_KEY, cachedSession());

    const { useAuthStore } = await import("./authStore");
    const state = useAuthStore.getState();

    expect(state.userId).toBe("teacher-1");
    expect(state.tenantId).toBe("school-a");
    expect(state.roles).toEqual(["TEACHER"]);
    // No tokens are ever cached; cookies are the only credential.
    expect(state.token).toBeNull();
    expect(state.refreshToken).toBeNull();
  });

  it("discards a cache older than the 30-day window", async () => {
    localStorage.setItem(
      SESSION_CACHE_KEY,
      cachedSession({ saved_at: Date.now() - 31 * DAY_MS }),
    );

    const { useAuthStore } = await import("./authStore");

    expect(useAuthStore.getState().userId).toBeNull();
    expect(localStorage.getItem(SESSION_CACHE_KEY)).toBeNull();
  });

  it("restoreCachedSession rehydrates identity without a token", async () => {
    localStorage.setItem(SESSION_CACHE_KEY, cachedSession());
    const { useAuthStore } = await import("./authStore");

    useAuthStore.setState({ userId: null, tenantId: null, roles: [], hydrated: false });
    const restored = useAuthStore.getState().restoreCachedSession();

    expect(restored).toBe(true);
    expect(useAuthStore.getState().userId).toBe("teacher-1");
    expect(useAuthStore.getState().hydrated).toBe(true);
    expect(useAuthStore.getState().token).toBeNull();
  });

  it("clearAuth removes the cache", async () => {
    localStorage.setItem(SESSION_CACHE_KEY, cachedSession());
    const { useAuthStore } = await import("./authStore");

    useAuthStore.getState().clearAuth();

    expect(useAuthStore.getState().userId).toBeNull();
    expect(localStorage.getItem(SESSION_CACHE_KEY)).toBeNull();
  });
});
