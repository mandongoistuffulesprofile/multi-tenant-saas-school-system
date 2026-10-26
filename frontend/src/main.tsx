import React from "react";
import ReactDOM from "react-dom/client";
import axios from "axios";
import { BrowserRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import App from "./App";
import i18n from "./i18n";
import "./styles/index.css";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/toast/ToastProvider";
import { installSyncHooks } from "./lib/sync";
import { useAuthStore, isTokenValid } from "./lib/authStore";

installSyncHooks();

/**
 * On boot, if the stored access token has expired but a refresh token exists,
 * silently exchange it for a fresh access token. Runs exactly once and uses a
 * bare axios call so it can never re-enter the response interceptor.
 */
async function bootstrapSession() {
  const { token, refreshToken, setAuth, clearAuth } = useAuthStore.getState();

  if (isTokenValid(token)) return; // still good

  if (!refreshToken) {
    if (token) clearAuth();
    return;
  }

  const API_BASE = (import.meta as any).env.VITE_API_BASE || "/api/v1";
  try {
    const { data } = await axios.post(
      `${API_BASE}/auth/refresh`,
      { refresh_token: refreshToken },
      { headers: { "Content-Type": "application/json" } }
    );
    const pair = data?.token_pair ?? data;
    if (!pair?.access_token) throw new Error("Invalid refresh response");

    // The refresh response does not carry identity, so keep the stored values.
    setAuth(
      pair.access_token,
      pair.refresh_token || refreshToken,
      useAuthStore.getState().userId || "",
      useAuthStore.getState().tenantId || "",
      useAuthStore.getState().roles
    );
  } catch {
    // Refresh token is expired/revoked — the session is genuinely over.
    clearAuth();
  }
}

bootstrapSession().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <I18nextProvider i18n={i18n}>
        {/* Opt into the v7 behaviours now so the console stays free of
            deprecation warnings in development. */}
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ToastProvider>
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
          </ToastProvider>
        </BrowserRouter>
      </I18nextProvider>
    </React.StrictMode>
  );
});
