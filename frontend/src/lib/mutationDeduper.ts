import { useRef, useCallback } from "react";

/**
 * Small in-flight dedup hook for POST/PUT handlers that can be triggered more
 * than once while a previous call is still in flight (double-click on the
 * submit button, rapid form resubmission, etc.).
 *
 * Usage:
 *   const postLedger = useApiDeduper();
 *   const handleSubmit = async () => {
 *     if (!postLedger()) return; // already posting
 *     try {
 *       await api.post("/finance/payments", { ... });
 *     } finally {
 *       postLedger.reset();
 *     }
 *   };
 *
 * The helper is intentionally file-per-handler, not global, so two different
 * forms on the same page can submit concurrently without blocking each other.
 */
export function useApiDeduper() {
  const inFlight = useRef(false);

  const run = useCallback(() => {
    if (inFlight.current) {
      return false;
    }
    inFlight.current = true;
    return true;
  }, []);

  const reset = useCallback(() => {
    inFlight.current = false;
  }, []);

  return Object.assign(run, { reset });
}
