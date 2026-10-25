import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../lib/authStore";
import { api } from "../lib/api";
import { useToast } from "../components/toast/ToastProvider";

export default function LoginPage() {
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await api.post("/auth/login", { identifier: email || identifier, password });
      const { token_pair, user_id, tenant_id, roles } = response.data;
      localStorage.setItem("access_token", token_pair.access_token);
      localStorage.setItem("refresh_token", token_pair.refresh_token);
      setAuth(token_pair.access_token, token_pair.refresh_token, user_id, tenant_id, roles);
      navigate("/dashboard");
    } catch (err: any) {
      const message = err.response?.data?.message || t("errors.network_error");
      toast(message, { type: "error", title: t("error") });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-6 space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-kenyan-red">{t("auth.welcome")}</h1>
          <p className="text-gray-600">{t("auth.welcome_subtitle")}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="tenant-id">{t("tenant_id")}</label>
            <input
              id="tenant-id"
              type="text"
              className="input-field"
              placeholder={t("auth.school_code_placeholder")}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
            />
          </div>

          <div>
            <label className="label" htmlFor="email">{t("email")}</label>
            <input
              id="email"
              type="email"
              className="input-field"
              placeholder={t("auth.email_placeholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              aria-invalid="false"
            />
          </div>

          <div>
            <label className="label" htmlFor="password">{t("password")}</label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                className="input-field pr-12"
                placeholder={t("auth.password_placeholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-kenyan-red transition"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? t("auth.hide_password") : t("auth.show_password")}
                aria-pressed={showPassword}
              >
                {showPassword ? t("auth.hide_password") : t("auth.show_password")}
              </button>
            </div>
          </div>

          <div className="text-right">
            <Link to="/forgot-password" className="text-sm text-kenyan-red hover:underline">
              {t("forgot_password")}
            </Link>
          </div>

          <button
            type="submit"
            className="btn-primary w-full"
            disabled={loading}
          >
            {loading ? t("loading") : t("auth.login_button")}
          </button>
        </form>

        <div className="text-center text-sm text-gray-600">
          {t("auth.no_account")} <Link to="/parent/activate" className="text-kenyan-red hover:underline">{t("auth.contact_admin")}</Link>
        </div>
      </div>
    </div>
  );
}
