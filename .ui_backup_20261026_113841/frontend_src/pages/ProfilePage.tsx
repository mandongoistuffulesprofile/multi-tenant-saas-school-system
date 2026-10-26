import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../lib/authStore";
import { api } from "../lib/api";

export default function ProfilePage() {
  const [locale, setLocale] = useState("en");
  const [loading, setLoading] = useState(false);
  const { token, tenantId, roles, userId, clearAuth } = useAuthStore();
  const { t } = useTranslation();

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

  const handleLogout = () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    clearAuth();
    window.location.href = "/login";
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-2xl mx-auto">
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

            <button
              type="submit"
              className="btn-primary w-full"
              disabled={loading}
            >
              {loading ? t("loading") : t("save")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
