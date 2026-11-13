import { create } from "zustand";
import { attachOfflineTenant, detachOfflineTenant, forgetOfflineTenantStorage } from "./offline";

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
  restoreCachedSession: () => boolean;
}

// Session tokens live in HttpOnly cookies set by the backend; this store only
// mirrors identity/roles in memory for UI decisions. For offline-first use we
// cache that non-sensitive identity (never access/refresh tokens) so a reload
// without network can still render the app and flush the sync queue once the
// connection returns. The API re-authorises every request server-side, so a
// tampered cache can never grant data access.
const SESSION_CACHE_KEY = "skulapp_session_v1";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface CachedSession {
  userId: string;
  tenantId: string;
  roles: string[];
  saved_at: number;
}

function readCachedSession(): CachedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSession;
    if (!parsed?.userId || !Array.isArray(parsed.roles)) return null;
    if (Date.now() - Number(parsed.saved_at) > SESSION_TTL_MS) {
      localStorage.removeItem(SESSION_CACHE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function persistSession(userId: string, tenantId: string, roles: string[]) {
  if (!userId) return;
  try {
    const snapshot: CachedSession = {
      userId,
      tenantId,
      roles,
      saved_at: Date.now(),
    };
    localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    /* private mode / quota: offline restore is best-effort */
  }
}

function clearCachedSession() {
  try {
    localStorage.removeItem(SESSION_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

const cachedSession = readCachedSession();

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  refreshToken: null,
  userId: cachedSession?.userId ?? null,
  tenantId: cachedSession?.tenantId ?? null,
  roles: cachedSession?.roles ?? [],
  hydrated: false,
  setAuth: (token, refreshToken, userId, tenantId, roles) => {
    persistSession(userId, tenantId, roles);
    if (tenantId) {
      void attachOfflineTenant(tenantId).catch(() => { /* ignore */ });
    }
    set({ token, refreshToken, userId, tenantId, roles, hydrated: true });
  },
  clearAuth: () => {
    const { tenantId } = get();
    if (tenantId) {
      void detachOfflineTenant().catch(() => { /* ignore */ });
      void forgetOfflineTenantStorage().catch(() => { /* ignore */ });
    }
    clearCachedSession();
    set({ token: null, refreshToken: null, userId: null, tenantId: null, roles: [], hydrated: true });
  },
  setTenant: (tenantId, roles) => {
    const { userId } = get();
    persistSession(userId ?? "", tenantId, roles);
    void attachOfflineTenant(tenantId).catch(() => { /* ignore */ });
    set({ tenantId, roles });
  },
  setHydrated: (hydrated) => set({ hydrated }),
  restoreCachedSession: () => {
    const cached = readCachedSession();
    if (!cached) return false;
    if (cached.tenantId) {
      void attachOfflineTenant(cached.tenantId).catch(() => { /* ignore */ });
    }
    set({
      userId: cached.userId,
      tenantId: cached.tenantId,
      roles: cached.roles,
      hydrated: true,
    });
    return true;
  },
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
