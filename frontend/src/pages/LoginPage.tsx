import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../lib/authStore";
import { api } from "../lib/api";
import { useToast } from "../components/toast/ToastProvider";
import RoleCard from "../components/atoms/RoleCard";

type Stage = "login" | "pick-school";

interface Membership {
  tenant_id: string;
  school_name: string;
  subdomain: string;
  role: string;
  status: string;
}

export default function LoginPage() {
  const [stage, setStage] = useState<Stage>("login");
  const [tenantCode, setTenantCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [schools, setSchools] = useState<Membership[]>([]);
  const [error, setError] = useState("");
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);

  const routeByRole = (roleList: string[]) => {
    if (roleList.includes("SAAS_ADMIN") || roleList.includes("SUPER_ADMIN")) {
      navigate("/platform/operations", { replace: true });
    } else if (roleList.includes("TEACHER")) {
      navigate("/teacher/classes", { replace: true });
    } else if (roleList.includes("PARENT") || roleList.includes("GUARDIAN")) {
      navigate("/parent", { replace: true });
    } else {
      navigate("/dashboard", { replace: true });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      // Backend contract: identifier, email, password, subdomain, tenant_code.
      // No "role" field — the server resolves roles from tenant_memberships.
      const payload: Record<string, string> = {
        identifier: (username.trim() || tenantCode.trim()),
        password,
      };
      if (tenantCode.trim()) {
        payload.tenant_code = tenantCode.trim();
        payload.subdomain = tenantCode.trim();
      }

      const response = await api.post("/auth/login", payload);
      const { token_pair, user_id, tenant_id, roles } = response.data;
      // Session cookies are set by the backend (HttpOnly). Mirror the access
      // token in memory for UI decisions only; it is never written to
      // localStorage.
      setAuth(
        token_pair.access_token,
        token_pair.refresh_token,
        user_id,
        tenant_id,
        roles,
      );

      // Inline post-auth school chooser — no separate /select-school bounce.
      const roleList: string[] = Array.isArray(roles) ? roles : [roles];
      setStage("pick-school");
      try {
        const memResp = await api.get("/me/memberships");
        const memData = memResp.data;
        const list: Membership[] = Array.isArray(memData)
          ? memData
          : (memData?.memberships ?? []);
        setSchools(list);
        if (list.length === 1) {
          await handleSelect(list[0].tenant_id);
          return;
        }
      } catch {
        setSchools([]);
        setError(
          t("errors.network_error", {
            defaultValue: "Could not load your schools. Try again.",
          }),
        );
      }
    } catch (err: any) {
      const message =
        err.response?.data?.message || t("errors.network_error");
      setError(message);
      toast(message, { type: "error", title: t("error") });
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async (tenantId: string) => {
    setSwitching(tenantId);
    try {
      const { data } = await api.post("/auth/tenant/switch", {
        tenant_id: tenantId,
      });
      const pair = data?.token_pair;
      if (!pair?.access_token) throw new Error("missing token pair");
      setAuth(
        pair.access_token,
        pair.refresh_token,
        data.user_id,
        data.tenant_id,
        data.roles ?? [],
      );
      const roleList: string[] = Array.isArray(data.roles)
        ? data.roles
        : [data.roles];
      routeByRole(roleList);
    } catch (err: any) {
      toast(
        err?.response?.data?.message || t("errors.network_error"),
        { type: "error", title: t("error") },
      );
    } finally {
      setSwitching(null);
    }
  };

  if (stage === "pick-school") {
    if (error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <div className="w-full max-w-md p-6 bg-white rounded-2xl shadow-sm border border-gray-200">
            <h2 className="text-xl font-bold text-kenyan-red mb-6">
              {t("tenant_id")}
            </h2>
            <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm">
              {error}
            </div>
            <button
              onClick={() => {
                setError("");
                setStage("login");
              }}
              className="mt-4 w-full text-sm text-kenyan-red hover:underline"
            >
              {t("common.btn_back", { defaultValue: "Back" })}
            </button>
          </div>
        </div>
      );
    }
    if (schools.length === 0) {
      routeByRole([]);
      return null;
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-md p-6 bg-white rounded-2xl shadow-sm border border-gray-200">
          <h2 className="text-xl font-bold text-kenyan-red mb-6">
            {t("tenant_id")}
          </h2>
          <p className="text-sm text-gray-600 mb-6">
            {t("auth.select_school", { defaultValue: "Choose your school" })}
          </p>
          <div className="space-y-3">
            {schools.map((school) => (
              <RoleCard
                key={school.tenant_id}
                schoolName={school.school_name}
                subdomain={school.subdomain}
                role={school.role}
                status={school.status}
                disabled={switching !== null}
                onClick={() => handleSelect(school.tenant_id)}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-6 space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-kenyan-red">
            {t("auth.welcome")}
          </h1>
          <p className="text-gray-600">{t("auth.welcome_subtitle")}</p>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="tenant-id">
              {t("tenant_id", { defaultValue: "School Code (Optional)" })}
            </label>
            <input
              id="tenant-id"
              type="text"
              className="input-field"
              placeholder={t("auth.school_code_placeholder", {
                defaultValue: "e.g. smoke-school",
              })}
              value={tenantCode}
              onChange={(e) => setTenantCode(e.target.value)}
              autoComplete="organization"
            />
          </div>

          <div>
            <label className="label" htmlFor="username">
              {t("username", { defaultValue: "Username/Email/Phone" })}
            </label>
            <input
              id="username"
              type="text"
              className="input-field"
              placeholder={t("auth.username_placeholder", {
                defaultValue: "Enter your username, email or phone",
              })}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="password">
              {t("password")}
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                className="input-field pr-12"
                placeholder={t("auth.password_placeholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-kenyan-red transition"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? t("auth.hide_password") : t("auth.show_password")}
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
