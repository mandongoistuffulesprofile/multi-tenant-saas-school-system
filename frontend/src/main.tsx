import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import App from "./App";
import i18n from "./i18n";
import "./styles/index.css";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/toast/ToastProvider";
import { installSyncHooks, registerBackgroundSync } from "./lib/sync";
import { registerServiceWorker } from "./serviceWorkerRegistration";
import { bootstrapSession } from "./lib/bootstrapSession";
import { captureClientSource } from "./lib/clientSource";

captureClientSource();
installSyncHooks();
registerServiceWorker();
// After the SW is ready, ask the browser to flush the outbox when the
// network comes back — even if the user killed the tab.
registerBackgroundSync();

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
