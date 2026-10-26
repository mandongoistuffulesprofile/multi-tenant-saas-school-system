import axios from "axios";
import { useAuthStore } from "./authStore";

const API_BASE = (import.meta as any).env.VITE_API_BASE || "/api/v1";

export const api = axios.create({
  baseURL: API_BASE,
  headers: {
    "Content-Type": "application/json",
  },
});

// Endpoints that must never carry a bearer token. Attaching a stale token to
// these causes the server to reject the request before the handler runs
// (e.g. login failing with "Invalid or expired token").
const PUBLIC_PATHS = [
  "/auth/login",
  "/auth/refresh",
  "/auth/otp/request",
  "/auth/otp/verify",
  "/auth/password/reset/request",
  "/auth/password/reset/confirm",
  "/auth/parent/activate",
  "/auth/invite/accept",
];

function isPublicPath(url?: string) {
  if (!url) return false;
  return PUBLIC_PATHS.some((p) => url.includes(p));
}

api.interceptors.request.use((config) => {
  if (!isPublicPath(config.url)) {
    const token = localStorage.getItem("access_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Single-flight guard: while a refresh is in progress, other 401s wait on the
// same promise instead of each firing their own refresh request.
let refreshPromise: Promise<string> | null = null;

function clearSession() {
  useAuthStore.getState().clearAuth();
}

async function performRefresh(): Promise<string> {
  const refreshToken = localStorage.getItem("refresh_token");
  if (!refreshToken) {
    throw new Error("No refresh token");
  }

  // Use a bare axios call so the refresh request itself never re-enters
  // this interceptor (which would recurse forever on a 401).
  const { data } = await axios.post(
    `${API_BASE}/auth/refresh`,
    { refresh_token: refreshToken },
    { headers: { "Content-Type": "application/json" } }
  );

  // The refresh endpoint returns the token pair flat, while login nests it
  // under `token_pair`. Accept either shape.
  const pair = data?.token_pair ?? data;
  const accessToken = pair?.access_token;
  if (!accessToken) {
    throw new Error("Invalid refresh response");
  }

  localStorage.setItem("access_token", accessToken);
  if (pair?.refresh_token) {
    localStorage.setItem("refresh_token", pair.refresh_token);
  }
  return accessToken;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Retry transient network failures a couple of times before surfacing.
    if (!error.response && originalRequest && !originalRequest._networkRetry) {
      originalRequest._networkRetry = true;
      originalRequest._retryCount = (originalRequest._retryCount || 0) + 1;
      if (originalRequest._retryCount <= 2) {
        await new Promise((r) => setTimeout(r, 500 * originalRequest._retryCount));
        return api(originalRequest);
      }
    }

    if (error.response?.status !== 401 || !originalRequest) {
      return Promise.reject(error);
    }

    // Never try to refresh the refresh endpoint, and never retry twice.
    const isAuthEndpoint =
      originalRequest.url?.includes("/auth/refresh") ||
      originalRequest.url?.includes("/auth/login");
    if (isAuthEndpoint || originalRequest._retry) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      if (!refreshPromise) {
        refreshPromise = performRefresh().finally(() => {
          refreshPromise = null;
        });
      }
      const accessToken = await refreshPromise;
      originalRequest.headers.Authorization = `Bearer ${accessToken}`;
      return api(originalRequest);
    } catch {
      clearSession();
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
      return Promise.reject(error);
    }
  }
);
