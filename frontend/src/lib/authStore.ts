import { create } from "zustand";
import { clearOfflineData } from "./offline";

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  userId: string | null;
  tenantId: string | null;
  roles: string[];
  hydrated: boolean;
  setAuth: (token: string, refreshToken: string, userId: string, tenantId: string, roles: string[]) => void;
  clearAuth: () => void;
  setTenant: (tenantId: string, roles: string[]) => void;
  setHydrated: (hydrated: boolean) => void;
}

// Session tokens live in HttpOnly cookies set by the backend; this store only
// mirrors identity/roles in memory for UI decisions. Nothing sensitive is
// persisted to localStorage.
export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  refreshToken: null,
  userId: null,
  tenantId: null,
  roles: [],
  hydrated: false,
  setAuth: (token, refreshToken, userId, tenantId, roles) => {
    set({ token, refreshToken, userId, tenantId, roles, hydrated: true });
  },
  clearAuth: () => {
    set({ token: null, refreshToken: null, userId: null, tenantId: null, roles: [], hydrated: true });
    void clearOfflineData().catch(() => {
      /* ignore */
    });
  },
  setTenant: (tenantId, roles) => {
    set({ tenantId, roles });
  },
  setHydrated: (hydrated) => set({ hydrated }),
}));

// Best-effort JWT validity check (used only for UI hints). With cookie auth,
// the browser sends HttpOnly cookies; absence of an in-memory token does not
// imply logged-out if cookies exist.
export function isTokenValid(token: string | null | undefined): boolean {
  if (!token) return false;
  try {
    const [, payload] = token.split(".");
    if (!payload) return false;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const exp = JSON.parse(json)?.exp;
    if (typeof exp !== "number") return false;
    return exp * 1000 > Date.now() + 5000;
  } catch {
    return false;
  }
}
