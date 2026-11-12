import axios from "axios";
import { useAuthStore } from "./authStore";

export interface SessionBootstrapClient {
  me: () => Promise<{ data?: any }>;
  refresh: () => Promise<unknown>;
}

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "/api/v1";

/** Cookie-backed client used in the browser. Tokens stay in HttpOnly cookies. */
export function defaultSessionClient(): SessionBootstrapClient {
  return {
    me: () =>
      axios.get(`${API_BASE}/me`, {
        withCredentials: true,
        headers: { "Content-Type": "application/json" },
      }),
    refresh: () =>
      axios.post(
        `${API_BASE}/auth/refresh`,
        {},
        { withCredentials: true, headers: { "Content-Type": "application/json" } },
      ),
  };
}

/**
 * Bootstrap the session from HttpOnly cookies by calling /me.
 *
 * The access cookie lives 15 minutes, so a cold start on a returning device
 * gets a 401 while the refresh cookie is still valid. Bootstrap therefore
 * refreshes once and retries /me. It only clears the session when the server
 * explicitly rejects the refresh; a network failure keeps the cached identity
 * so the app stays usable offline.
 */
export async function bootstrapSession(
  client: SessionBootstrapClient = defaultSessionClient(),
): Promise<void> {
  const { setAuth, clearAuth, restoreCachedSession, setHydrated } = useAuthStore.getState();

  const applyMe = (data: any) => {
    const roles = Array.isArray(data?.roles) ? data.roles : [];
    setAuth("", "", data?.user_id || "", data?.tenant_id || "", roles);
  };

  try {
    applyMe((await client.me()).data);
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 401 || status === 403) {
      try {
        await client.refresh();
        applyMe((await client.me()).data);
      } catch (refreshErr: any) {
        // Only an explicit rejection means the session is really gone.
        if (!refreshErr?.response) {
          restoreCachedSession();
        } else {
          clearAuth();
        }
      }
    } else {
      // Offline or server unreachable: fall back to the last known identity.
      restoreCachedSession();
    }
  } finally {
    setHydrated(true);
  }
}
