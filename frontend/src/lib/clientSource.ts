/**
 * Distinguishes an installed PWA launch from an ordinary browser visit.
 *
 * The manifest start_url is `/?source=pwa`. We keep the value in sessionStorage
 * (not localStorage, so it cannot claim every later browser session) and send
 * it as X-Client-Source, which the API access log records. No analytics vendor
 * or personal data is involved.
 */

const KEY = "shule_client_source";
const ALLOWED = new Set(["pwa", "web"]);

export function captureClientSource(): string {
  if (typeof window === "undefined") return "web";
  let source = "web";
  try {
    const param = new URLSearchParams(window.location.search).get("source");
    if (param && ALLOWED.has(param)) {
      sessionStorage.setItem(KEY, param);
    }
    source = sessionStorage.getItem(KEY) || "web";
  } catch {
    source = "web";
  }
  document.documentElement.dataset.clientSource = source;
  return source;
}

export function getClientSource(): string {
  if (typeof window === "undefined") return "web";
  try {
    return sessionStorage.getItem(KEY) || "web";
  } catch {
    return "web";
  }
}
