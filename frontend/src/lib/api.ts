import axios from "axios";
import { useAuthStore } from "./authStore";

const API_BASE = (import.meta as any).env.VITE_API_BASE || "/api/v1";

export const api = axios.create({
  baseURL: API_BASE,
  headers: {
    "Content-Type": "application/json",
  },
  // Credentials (cookies) are sent cross-origin so HttpOnly session cookies
  // are attached to every request.
  withCredentials: true,
});

// Endpoints that must never require authentication. These stay public so a
// login/refresh flow can bootstrap a session without a cookie yet.
const PUBLIC_PATHS = [
  "/auth/login",
  "/auth/refresh",
  "/auth/otp/request",
  "/auth/otp/verify",
  "/auth/password/reset/request",
  "/auth/password/reset/confirm",
  "/auth/password/reset/questions",
  "/auth/password/reset/answers",
  "/auth/password/reset/assistance",
  "/auth/password/reset/code",
  "/auth/recovery/questions",
  "/auth/parent/activate",
  "/auth/invite/accept",
];

function isPublicPath(url?: string) {
  if (!url) return false;
  return PUBLIC_PATHS.some((p) => url.includes(p));
}

// On mutating requests (POST/PUT/PATCH/DELETE) that are not public, echo the
// CSRF cookie back in the X-CSRF-Token header (double-submit pattern). The
// backend enforces this for cookie-authenticated unsafe methods.
api.interceptors.request.use((config) => {
  if (isPublicPath(config.url)) {
    return config;
  }
  if (
    config.method &&
    !["get", "head", "options"].includes(config.method.toLowerCase())
  ) {
    const token = document.cookie
      .split("; ")
      .find((row) => row.startsWith("csrf_token="))
      ?.split("=")[1];
    if (token) {
      config.headers["X-CSRF-Token"] = token;
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
  // Use a bare axios call so the refresh request itself never re-enters
  // this interceptor (which would recurse forever on a 401). The refresh
  // cookie is sent automatically via withCredentials.
  const { data } = await axios.post(
    `${API_BASE}/auth/refresh`,
    {},
    { headers: { "Content-Type": "application/json" } }
  );

  // The refresh endpoint returns the token pair flat, while login nests it
  // under `token_pair`. Accept either shape.
  const pair = data?.token_pair ?? data;
  const accessToken = pair?.access_token;
  if (!accessToken) {
    throw new Error("Invalid refresh response");
  }

  return accessToken;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Retry transient network failures a couple of times before surfacing.
    // The counter is the only guard: a boolean latch would stop after the
    // first retry and leave the second attempt unused.
    if (!error.response && originalRequest) {
      const attempts = (originalRequest._retryCount || 0) + 1;
      originalRequest._retryCount = attempts;
      if (attempts <= 2) {
        await new Promise((r) => setTimeout(r, 500 * attempts));
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
      // Retry the original request; the cookie is re-attached automatically.
      return api(originalRequest);
    } catch (refreshError: any) {
      // Network error while refreshing: keep the session alive for read-only
      // offline use. Only log out when the server explicitly rejects the
      // refresh token (401/403).
      if (!refreshError?.response) {
        return Promise.reject(error);
      }
      clearSession();
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
      return Promise.reject(error);
    }
  }
);
