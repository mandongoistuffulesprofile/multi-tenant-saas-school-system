import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuthStore } from "../../lib/authStore";

/** Where the platform desk records a support session it has started. */
export const IMPERSONATION_KEYS = ["imp_school", "imp_session_id", "imp_expires_at"] as const;

export type ImpersonationSession = {
  school: string;
  sessionId: string;
  expiresAt: string;
};

/**
 * The session the platform desk started on this tab, if any.
 *
 * The desk writes these when it posts a support session, so the same storage has
 * to be read here: the banner used to look in localStorage and never appeared,
 * leaving an audit session running with nothing on screen to end it.
 */
export function readImpersonationSession(): ImpersonationSession | null {
  try {
    const school = sessionStorage.getItem("imp_school");
    const sessionId = sessionStorage.getItem("imp_session_id");
    if (!school || !sessionId) return null;
    return {
      school,
      sessionId,
      expiresAt: sessionStorage.getItem("imp_expires_at") || "",
    };
  } catch {
    // Storage can be unavailable (private mode, blocked cookies).
    return null;
  }
}

export function clearImpersonationSession() {
  try {
    for (const key of IMPERSONATION_KEYS) sessionStorage.removeItem(key);
    // Older builds stored the school name here; clear it when we see it.
    localStorage.removeItem("imp_school");
    sessionStorage.removeItem("imp_restore");
  } catch {
    /* nothing else to do */
  }
}

function formatExpiry(expiresAt: string): string {
  if (!expiresAt) return "";
  const at = new Date(expiresAt);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * The audit-session strip shown while a platform operator is inspecting a school.
 *
 * Ending it revokes the session server-side so it stops being usable immediately,
 * instead of being left to expire on its own. A session the server no longer knows
 * about (already ended, or expired and swept) is treated as over, not as an error.
 */
export default function ImpersonationBanner() {
  const [session, setSession] = useState<ImpersonationSession | null>(readImpersonationSession);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const navigate = useNavigate();

  if (!session) return null;

  const endsAt = formatExpiry(session.expiresAt);

  const endSession = async () => {
    setEnding(true);
    setError(null);
    try {
      await api.post(`/platform/impersonations/${encodeURIComponent(session.sessionId)}/end`);
    } catch (err: any) {
      // 404 means it is already over; anything else leaves it running and says so.
      if (err?.response?.status !== 404) {
        setError(
          err?.response?.data?.message ||
            "Imeshindikana kumaliza kikao cha ukaguzi. Jaribu tena.",
        );
        setEnding(false);
        return;
      }
    }
    clearImpersonationSession();
    setSession(null);
    clearAuth();
    navigate("/platform/operations");
  };

  return (
    <div className="w-full bg-slate-900 text-white text-xs px-4 py-2 flex flex-wrap items-center justify-between gap-2 no-print">
      <span className="font-bold tracking-wide">
        🎭 AUDIT SESSION: viewing <b>{session.school}</b> as school admin
        {endsAt ? ` (until ${endsAt})` : ""} — every action is attributed and logged
        (Platform Audit)
      </span>
      <div className="flex items-center gap-3">
        {error && (
          <span role="alert" className="text-rose-300 font-bold">
            {error}
          </span>
        )}
        <button
          onClick={endSession}
          disabled={ending}
          className="px-3 py-1 rounded-md bg-white text-slate-900 font-black hover:bg-slate-100 disabled:opacity-60"
        >
          {ending ? "Ending…" : "End impersonation"}
        </button>
      </div>
    </div>
  );
}
