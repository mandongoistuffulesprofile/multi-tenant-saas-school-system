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
import { installSyncHooks, registerBackgroundSync } from "./lib/sync";
import { registerServiceWorker } from "./serviceWorkerRegistration";
import { useAuthStore } from "./lib/authStore";

installSyncHooks();
registerServiceWorker();
// After the SW is ready, ask the browser to flush the outbox when the
// network comes back — even if the user killed the tab.
registerBackgroundSync();

/**
 * Bootstrap session from HttpOnly cookies by calling /me.
 * Cookies are sent automatically; on 401 the API interceptor will attempt a
 * cookie-based refresh and retry. We never persist tokens in JS storage.
 */
async function bootstrapSession() {
  const { setAuth, clearAuth, setHydrated } = useAuthStore.getState();
  const API_BASE = (import.meta as any).env.VITE_API_BASE || "/api/v1";

  const fetchMe = () =>
    axios.get(`${API_BASE}/me`,
      { withCredentials: true, headers: { "Content-Type": "application/json" } });

  try {
    const { data } = await fetchMe();
    const roles = Array.isArray(data?.roles) ? data.roles : [];
    setAuth("", "", data?.user_id || "", data?.tenant_id || "", roles);
    return;
  } catch (err: any) {
    // The access token lives in an HttpOnly cookie and expires after 15
    // minutes. A cold start on a returning device therefore gets a 401 while
    // the refresh cookie is still valid — refresh once before deciding the
    // user is signed out, otherwise every offline/returning launch logged the
    // teacher out.
    if (err?.response?.status === 401 || err?.response?.status === 403) {
      try {
        await axios.post(`${API_BASE}/auth/refresh`, {},
          { withCredentials: true, headers: { "Content-Type": "application/json" } });
        const { data } = await fetchMe();
        const roles = Array.isArray(data?.roles) ? data.roles : [];
        setAuth("", "", data?.user_id || "", data?.tenant_id || "", roles);
        return;
      } catch (refreshErr: any) {
        // Only an explicit rejection means the session is really gone. A
        // network failure keeps the cached identity for read-only offline use.
        if (!refreshErr?.response) {
          useAuthStore.getState().restoreCachedSession();
        } else {
          clearAuth();
        }
        return;
      }
    }
    // Network/offline: fall back to the last known identity so pages and the
    // sync queue stay reachable. Tokens are never cached; the server
    // re-authorises on the next successful request.
    useAuthStore.getState().restoreCachedSession();
  } finally {
    useAuthStore.getState().setHydrated(true);
  }
}

bootstrapSession().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <I18nextProvider i18n={i18n}>
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
