import { create } from "zustand";

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  userId: string | null;
  tenantId: string | null;
  roles: string[];
  setAuth: (token: string, refreshToken: string, userId: string, tenantId: string, roles: string[]) => void;
  clearAuth: () => void;
  setTenant: (tenantId: string, roles: string[]) => void;
}

// Hydrate from localStorage so a page reload keeps the session.
// Without this the store starts empty and RequireAuth bounces the user
// back to /login even though a valid token is still on disk.
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readRoles(): string[] {
  const raw = readStorage("roles");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Decode a JWT and report whether it is still valid (not expired).
 * Returns false for missing, malformed, or expired tokens.
 */
export function isTokenValid(token: string | null | undefined): boolean {
  if (!token) return false;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json);
    if (typeof claims.exp !== "number") return true; // no exp claim — assume usable
    return claims.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

// Only hydrate an access token that has not expired. An expired token would
// otherwise bounce the user into the dashboard, where every request 401s.
const storedAccessToken = readStorage("access_token");
const initialToken = isTokenValid(storedAccessToken) ? storedAccessToken : null;
const initialRefreshToken = readStorage("refresh_token");
const initialUserId = readStorage("user_id");
const initialTenantId = readStorage("tenant_id");
const initialRoles = readRoles();

export const useAuthStore = create<AuthState>((set) => ({
  token: initialToken,
  refreshToken: initialRefreshToken,
  userId: initialUserId,
  tenantId: initialTenantId,
  roles: initialRoles,
  setAuth: (token, refreshToken, userId, tenantId, roles) => {
    try {
      localStorage.setItem("access_token", token);
      localStorage.setItem("refresh_token", refreshToken);
      localStorage.setItem("user_id", userId);
      localStorage.setItem("tenant_id", tenantId);
      localStorage.setItem("roles", JSON.stringify(roles));
    } catch {
      /* storage unavailable — in-memory state still works */
    }
    set({ token, refreshToken, userId, tenantId, roles });
  },
  clearAuth: () => {
    try {
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
      localStorage.removeItem("user_id");
      localStorage.removeItem("tenant_id");
      localStorage.removeItem("roles");
    } catch {
      /* ignore */
    }
    set({ token: null, refreshToken: null, userId: null, tenantId: null, roles: [] });
  },
  setTenant: (tenantId, roles) => {
    try {
      localStorage.setItem("tenant_id", tenantId);
      localStorage.setItem("roles", JSON.stringify(roles));
    } catch {
      /* ignore */
    }
    set({ tenantId, roles });
  },
}));
