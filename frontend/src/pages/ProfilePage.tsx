import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../lib/authStore";
import { api } from "../lib/api";

interface CatalogQuestion {
  id: number;
  label: string;
}

export default function ProfilePage() {
  const [locale, setLocale] = useState("en");
  const [loading, setLoading] = useState(false);
  const { tenantId, roles, userId, clearAuth } = useAuthStore();
  const { t } = useTranslation();

  const [catalog, setCatalog] = useState<CatalogQuestion[]>([]);
  const [configured, setConfigured] = useState(false);
  const [selected, setSelected] = useState<number[]>([0, 0, 0]);
  const [answers, setAnswers] = useState<string[]>(["", "", ""]);
  const [currentPassword, setCurrentPassword] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryError, setRecoveryError] = useState("");

  useEffect(() => {
    let alive = true;
    api
      .get("/auth/recovery/questions")
      .then((r) => {
        if (alive) setCatalog(Array.isArray(r.data?.questions) ? r.data.questions : []);
      })
      .catch(() => {});
    api
      .get("/me/security-questions")
      .then((r) => {
        if (!alive) return;
        setConfigured(Boolean(r.data?.configured));
        const ids: number[] = Array.isArray(r.data?.questions)
          ? r.data.questions.map((q: CatalogQuestion) => q.id)
          : [];
        setSelected([ids[0] ?? 0, ids[1] ?? 0, ids[2] ?? 0]);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.patch("/me", { locale });
      localStorage.setItem("locale", locale);
    } catch {
      // Handle error
    } finally {
      setLoading(false);
    }
  };

  const handleRecoverySave = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecoveryMessage("");
    setRecoveryError("");
    if (selected.some((id) => !id) || new Set(selected).size !== 3) {
      setRecoveryError("Choose three different security questions.");
      return;
    }
    if (answers.some((answer) => answer.trim().length < 2)) {
      setRecoveryError("Answer all three questions (at least 2 characters each).");
      return;
    }
    if (!currentPassword) {
      setRecoveryError("Enter your current password to save recovery questions.");
      return;
    }
    setRecoveryLoading(true);
    try {
      await api.put("/me/security-questions", {
        current_password: currentPassword,
        answers: selected.map((questionId, index) => ({
          question_id: questionId,
          answer: answers[index],
        })),
      });
      setConfigured(true);
      setCurrentPassword("");
      setRecoveryMessage("Recovery questions saved. You can now reset your password without SMS or email.");
    } catch (err: any) {
      setRecoveryError(err.response?.data?.message || "Could not save recovery questions.");
    } finally {
      setRecoveryLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await api.post("/auth/logout");
    } catch {
      // Ignore logout errors; still clear local session.
    } finally {
      clearAuth();
      setLoading(false);
      window.location.href = "/login";
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-6">My Profile</h2>

          <form onSubmit={handleSave} className="space-y-6">
            <div>
              <label className="label">{t("language")}</label>
              <select
                className="input-field"
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
              >
                <option value="en">English</option>
                <option value="sw">Kiswahili</option>
              </select>
            </div>

            <div className="pt-4 border-t border-gray-200">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Account</h3>
              <p className="text-sm text-gray-600">User ID: {userId}</p>
              <p className="text-sm text-gray-600">Tenant: {tenantId}</p>
              <p className="text-sm text-gray-600">Roles: {roles.join(", ")}</p>
              <button
                type="button"
                onClick={handleLogout}
                className="mt-4 text-kenyan-red hover:underline text-sm"
              >
                Sign Out
              </button>
            </div>

            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? t("loading") : t("save")}
            </button>
          </form>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-start justify-between gap-4 mb-2">
            <h2 className="text-xl font-bold text-gray-900">Account recovery</h2>
            <span
              className={`text-xs font-semibold px-3 py-1 rounded-full border ${
                configured
                  ? "bg-kenyan-green/10 text-kenyan-green border-kenyan-green/20"
                  : "bg-amber-100 text-amber-700 border-amber-200"
              }`}
            >
              {configured ? "Set up" : "Not set up"}
            </span>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            Answer three security questions to reset your password without SMS or email. Pick
            questions whose answers will not change and that others cannot easily guess.
          </p>

          <form onSubmit={handleRecoverySave} className="space-y-4" noValidate>
            {[0, 1, 2].map((index) => (
              <div key={index} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select
                  className="input-field"
                  aria-label={`Security question ${index + 1}`}
                  value={selected[index]}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setSelected((prev) => prev.map((id, i) => (i === index ? value : id)));
                  }}
                  required
                >
                  <option value={0}>Choose a question…</option>
                  {catalog
                    .filter((q) => q.id === selected[index] || !selected.includes(q.id))
                    .map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.label}
                      </option>
                    ))}
                </select>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Your answer"
                  aria-label={`Answer ${index + 1}`}
                  value={answers[index]}
                  onChange={(e) =>
                    setAnswers((prev) => prev.map((a, i) => (i === index ? e.target.value : a)))
                  }
                  autoComplete="off"
                  required
                />
              </div>
            ))}

            <div>
              <label className="label" htmlFor="recovery-current-password">
                Current password
              </label>
              <input
                id="recovery-current-password"
                type="password"
                className="input-field"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                Required so someone using a borrowed session cannot change your recovery questions.
              </p>
            </div>

            {recoveryError && (
              <p className="text-sm text-red-600" role="alert">
                {recoveryError}
              </p>
            )}
            {recoveryMessage && (
              <p className="text-sm text-kenyan-green" role="status">
                {recoveryMessage}
              </p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={recoveryLoading}>
              {recoveryLoading ? "Saving…" : "Save recovery questions"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
