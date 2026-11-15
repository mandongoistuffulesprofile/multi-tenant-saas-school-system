import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { useToast } from "../components/toast/ToastProvider";

const MIN_PASSWORD_LENGTH = 12;

/**
 * Landing page for the one-shot link emailed by
 * POST /auth/password/reset/request: /auth/reset?token=...
 * The token is single-use, expires, and is never stored in the SPA.
 */
export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = (params.get("token") || "").trim();
  const { toast } = useToast();
  const { t } = useTranslation();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!token) {
      setError(t("reset_password_page.invalid_link"));
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(t("reset_password_page.too_short", { count: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("reset_password_page.mismatch"));
      return;
    }

    setLoading(true);
    try {
      await api.post("/auth/password/reset/confirm", {
        token,
        new_password: newPassword,
      });
      setDone(true);
      toast(t("reset_password_page.success_toast"), {
        type: "success",
        title: t("success"),
      });
    } catch (err: any) {
      setError(err.response?.data?.message || t("reset_password_page.failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md p-6 space-y-6 bg-white rounded-2xl shadow-sm border border-gray-200">
        <div className="text-center">
          <h1 className="text-xl font-bold text-kenyan-red">{t("reset_password_page.title")}</h1>
          <p className="text-gray-600 text-sm">{t("reset_password_page.subtitle")}</p>
        </div>

        {!token && (
          <div className="space-y-4" role="alert">
            <p className="text-sm text-red-600">{t("reset_password_page.missing_token")}</p>
            <Link to="/forgot-password" className="btn-primary w-full block text-center">
              {t("reset_password_page.request_new_link")}
            </Link>
          </div>
        )}

        {token && done && (
          <div className="text-center space-y-4" role="status" aria-live="polite">
            <h2 className="text-kenyan-green font-semibold">{t("reset_password_page.updated_title")}</h2>
            <p className="text-gray-600 text-sm">{t("reset_password_page.updated_body")}</p>
            <Link to="/login" className="btn-primary w-full block text-center">
              {t("reset_password_page.sign_in")}
            </Link>
          </div>
        )}

        {token && !done && (
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label className="label" htmlFor="reset-new-password">
                {t("reset_password_page.new_password")}
              </label>
              <input
                id="reset-new-password"
                type="password"
                className="input-field"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                {t("reset_password_page.min_length", { count: MIN_PASSWORD_LENGTH })}
              </p>
            </div>
            <div>
              <label className="label" htmlFor="reset-confirm-password">
                {t("reset_password_page.confirm_password")}
              </label>
              <input
                id="reset-confirm-password"
                type="password"
                className="input-field"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
            </div>

            {error && (
              <p className="text-sm text-red-600" role="alert" aria-live="assertive">
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? t("reset_password_page.saving") : t("reset_password_page.submit")}
            </button>
          </form>
        )}

        <div className="text-center text-sm">
          <Link to="/login" className="text-kenyan-red hover:underline">
            {t("reset_password_page.back_to_sign_in")}
          </Link>
        </div>
      </div>
    </div>
  );
}
