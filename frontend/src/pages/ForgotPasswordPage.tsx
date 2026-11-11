import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { useToast } from "../components/toast/ToastProvider";

type Mode = "email" | "phone";
type Step = "request" | "verify" | "done";

const MIN_PASSWORD_LENGTH = 12;

export default function ForgotPasswordPage() {
  const [mode, setMode] = useState<Mode>("email");
  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const { t } = useTranslation();
  const { toast } = useToast();

  const switchMode = (next: Mode) => {
    setMode(next);
    setError("");
    setMessage("");
  };

  const handleEmailRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.trim()) {
      setError("Enter the email address on your account.");
      return;
    }
    setLoading(true);
    try {
      const response = await api.post("/auth/password/reset/request", {
        email: email.trim(),
      });
      // The backend intentionally returns the same response for unknown
      // addresses so the form cannot be used to enumerate accounts.
      setMessage(
        response.data?.message ||
          "If an account exists for that email, a reset link has been sent.",
      );
      setStep("done");
    } catch (err: any) {
      toast(err.response?.data?.message || t("errors.network_error"), {
        type: "error",
        title: t("error"),
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!phone.trim()) {
      setError("Enter the phone number on your account.");
      return;
    }
    setLoading(true);
    try {
      const response = await api.post("/auth/otp/request", { phone: phone.trim() });
      setMessage(
        response.data?.message || "If the number is registered, a verification code has been sent.",
      );
      setStep("verify");
    } catch (err: any) {
      toast(err.response?.data?.message || t("errors.network_error"), {
        type: "error",
        title: t("error"),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/password/reset", {
        phone: phone.trim(),
        code: code.trim(),
        new_password: newPassword,
      });
      setMessage("Password reset successful. Sign in with your new password.");
      setStep("done");
    } catch (err: any) {
      toast(err.response?.data?.message || t("errors.network_error"), {
        type: "error",
        title: t("error"),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md p-6 space-y-6 bg-white rounded-2xl shadow-sm border border-gray-200">
        <div className="text-center">
          <h1 className="text-xl font-bold text-kenyan-red">{t("auth.reset_password")}</h1>
          <p className="text-gray-600 text-sm">
            Reset your password with an email link or a phone verification code.
          </p>
        </div>

        {step === "request" && (
          <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Reset method">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "email"}
              onClick={() => switchMode("email")}
              className={`px-3 py-2 rounded-lg text-sm border ${
                mode === "email"
                  ? "bg-kenyan-red text-white border-kenyan-red"
                  : "bg-white text-gray-700 border-gray-300"
              }`}
            >
              Email link
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "phone"}
              onClick={() => switchMode("phone")}
              className={`px-3 py-2 rounded-lg text-sm border ${
                mode === "phone"
                  ? "bg-kenyan-red text-white border-kenyan-red"
                  : "bg-white text-gray-700 border-gray-300"
              }`}
            >
              Phone code
            </button>
          </div>
        )}

        {step === "request" && mode === "email" && (
          <form onSubmit={handleEmailRequest} className="space-y-4" noValidate>
            <div>
              <label className="label" htmlFor="forgot-email">
                Email address
              </label>
              <input
                id="forgot-email"
                type="email"
                className="input-field"
                placeholder="you@school.example"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            {error && (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? t("loading") : "Send reset link"}
            </button>
          </form>
        )}

        {step === "request" && mode === "phone" && (
          <form onSubmit={handlePhoneRequest} className="space-y-4" noValidate>
            <div>
              <label className="label" htmlFor="forgot-phone">
                {t("phone")}
              </label>
              <input
                id="forgot-phone"
                type="tel"
                className="input-field"
                placeholder={t("auth.phone_placeholder")}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
                required
              />
            </div>
            {error && (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? t("loading") : t("send_code")}
            </button>
          </form>
        )}

        {step === "verify" && (
          <form onSubmit={handleReset} className="space-y-4" noValidate>
            <p className="text-sm text-gray-600">{message}</p>
            <div>
              <label className="label" htmlFor="forgot-code">
                {t("verification_code")}
              </label>
              <input
                id="forgot-code"
                type="text"
                className="input-field"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="forgot-new-password">
                {t("new_password")}
              </label>
              <input
                id="forgot-new-password"
                type="password"
                className="input-field"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                At least {MIN_PASSWORD_LENGTH} characters.
              </p>
            </div>
            <div>
              <label className="label" htmlFor="forgot-confirm-password">
                {t("confirm_password")}
              </label>
              <input
                id="forgot-confirm-password"
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
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? t("loading") : t("save")}
            </button>
          </form>
        )}

        {step === "done" && (
          <div className="text-center py-8 space-y-4" role="status" aria-live="polite">
            <h2 className="text-kenyan-green font-semibold">{t("success")}</h2>
            <p className="text-gray-600 text-sm">{message}</p>
            {mode === "phone" && (
              <Link to="/login" className="btn-primary w-full block text-center">
                Sign in
              </Link>
            )}
          </div>
        )}

        <div className="text-center text-sm">
          <Link to="/login" className="text-kenyan-red hover:underline">
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
