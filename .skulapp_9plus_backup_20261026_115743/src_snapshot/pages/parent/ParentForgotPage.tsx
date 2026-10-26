import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import Card from "../../components/atoms/Card";
import Input from "../../components/atoms/Input";
import Button from "../../components/atoms/Button";
import { api } from "../../lib/api";

export default function ParentForgotPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [step, setStep] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);
    setError(null);
    try {
      await api.post("/auth/password/reset/request", { email });
      setStep(1);
    } catch (err: any) {
      setError(err.response?.data?.message || t("errors.network_error", { defaultMessage: "Network error. Please check your connection." }));
    } finally {
      setProcessing(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);
    setError(null);
    try {
      await api.post("/auth/password/reset/confirm", { token, new_password: newPassword });
      setStep(2);
    } catch (err: any) {
      setError(err.response?.data?.message || t("errors.network_error", { defaultMessage: "Network error. Please check your connection." }));
    } finally {
      setProcessing(false);
    }
  };

  if (step === 2) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md p-6 text-center">
          <div className="text-4xl mb-3">✓</div>
          <h2 className="text-heading mb-2">{t("auth.reset_password", { defaultMessage: "Reset Password" })}</h2>
          <p className="text-body">{t("auth.password_reset_done", { defaultMessage: "Your password has been reset." })}</p>
          <Button variant="primary" onClick={() => navigate("/login")} fullWidth>{t("sign_in")}</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md p-6">
        <h1 className="text-display font-display text-center mb-6">
          {step === 0 ? t("forgot_password", { defaultMessage: "Forgot Password?" }) : t("auth.verification_code", { defaultMessage: "Verification Code" })}
        </h1>
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}
        <form onSubmit={step === 0 ? handleRequest : handleReset} className="space-y-4">
          {step === 0 && (
            <Input label={t("email")} type="email" placeholder="you@school.ke" value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} required />
          )}
          {step === 1 && (
            <>
              <Input label={t("auth.verification_code", { defaultMessage: "Verification Code" })} placeholder="XXXX-XXXX" value={token} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setToken(e.target.value)} required />
              <Input label={t("new_password", { defaultMessage: "New Password" })} type="password" value={newPassword} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPassword(e.target.value)} required />
            </>
          )}
          <Button variant="primary" type="submit" fullWidth loading={processing}>
            {step === 0 ? t("send_code", { defaultMessage: "Send Code" }) : t("auth.reset_password", { defaultMessage: "Reset Password" })}
          </Button>
        </form>
        <p className="text-center text-sm text-gray-600 mt-4">
          <Link to="/login" className="text-kenyan-red hover:underline">{t("back", { defaultMessage: "Back" })}</Link>
        </p>
      </Card>
    </div>
  );
}
