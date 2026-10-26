import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { useToast } from "../components/toast/ToastProvider";

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<"request" | "verify" | "reset">("request");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const { t } = useTranslation();
  const { toast } = useToast();

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await api.post("/auth/otp/request", { phone });
      setMessage(response.data.message);
      setStep("verify");
    } catch (err: any) {
      toast(err.response?.data?.message || t("errors.network_error"), { type: "error", title: t("error") });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/auth/password/reset", { phone, code, new_password: newPassword });
      setMessage("Password reset successful");
      setStep("reset");
    } catch (err: any) {
      toast(err.response?.data?.message || t("errors.network_error"), { type: "error", title: t("error") });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md p-6 space-y-6 bg-white rounded-2xl shadow-sm border border-gray-200">
        <div className="text-center">
          <h1 className="text-xl font-bold text-kenyan-red">{t("auth.reset_password")}</h1>
          <p className="text-gray-600 text-sm">{t("phone")}</p>
        </div>

        {step === "request" && (
          <form onSubmit={handleRequest} className="space-y-4">
            <div>
              <label className="label" htmlFor="forgot-phone">{t("phone")}</label>
              <input
                id="forgot-phone"
                type="tel"
                className="input-field"
                placeholder={t("auth.phone_placeholder")}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
              />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? t("loading") : t("send_code")}
            </button>
          </form>
        )}

        {step === "verify" && (
          <form className="space-y-4">
            <p className="text-sm text-gray-600">{message}</p>
            <div>
              <label className="label" htmlFor="forgot-code">{t("verification_code")}</label>
              <input
                id="forgot-code"
                type="text"
                className="input-field"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
              />
            </div>
            <div>
              <label className="label" htmlFor="forgot-new-password">{t("new_password")}</label>
              <input
                id="forgot-new-password"
                type="password"
                className="input-field"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="label" htmlFor="forgot-confirm-password">{t("confirm_password")}</label>
              <input
                id="forgot-confirm-password"
                type="password"
                className="input-field"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <button type="button" className="btn-primary w-full" onClick={handleReset} disabled={loading}>
              {loading ? t("loading") : t("save")}
            </button>
          </form>
        )}

        {step === "reset" && (
          <div className="text-center py-8">
            <h2 className="text-kenyan-green font-semibold">{t("success")}</h2>
            <p className="text-gray-600 text-sm mt-2" role="status" aria-live="polite">
              {message}
            </p>
            <button
              onClick={() => window.location.href = "/login"}
              className="mt-4 text-sm text-kenyan-red hover:underline"
            >
              {t("back")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
