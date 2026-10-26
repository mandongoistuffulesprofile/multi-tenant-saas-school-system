import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuthStore } from "../lib/authStore";
import { toast } from "../lib/toast";

interface Membership {
  tenant_id: string;
  school_name: string;
  subdomain: string;
  role: string;
  status: string;
}

export default function SchoolPickerPage() {
  const [schools, setSchools] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  useEffect(() => {
    loadSchools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSchools = async () => {
    try {
      // GET /me/memberships lists the tenants the authenticated user belongs to.
      const response = await api.get("/me/memberships");
      const data = response.data;
      // Support both { memberships: [...] } and bare array shapes.
      const list: Membership[] = Array.isArray(data) ? data : (data?.memberships ?? []);
      setSchools(list);
    } catch {
      setSchools([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async (tenantId: string, schoolName: string) => {
    setSwitching(tenantId);
    try {
      // POST /auth/tenant/switch issues a fresh token pair scoped to the
      // target tenant, so the session's tenant context and roles change.
      const { data } = await api.post("/auth/tenant/switch", { tenant_id: tenantId });
      const pair = data?.token_pair;
      if (!pair?.access_token) throw new Error("missing token pair");

      setAuth(
        pair.access_token,
        pair.refresh_token,
        data.user_id,
        data.tenant_id,
        data.roles ?? [],
      );
      navigate("/", { replace: true });
    } catch (err: any) {
      toast(
        err?.response?.data?.message || t("errors.network_error"),
        { type: "error", title: t("error") },
      );
    } finally {
      setSwitching(null);
    }
  };

  if (loading) return <div className="p-4">Loading schools...</div>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md p-6 bg-white rounded-2xl shadow-sm border border-gray-200">
        <h2 className="text-xl font-bold text-kenyan-red mb-6">{t("tenant_id")}</h2>
        <div className="space-y-3">
          {schools.map((school) => (
            <button
              key={school.tenant_id}
              onClick={() => handleSelect(school.tenant_id, school.school_name)}
              disabled={switching !== null}
              className="w-full p-4 border border-gray-300 rounded-xl text-left hover:bg-gray-50 transition-colors disabled:opacity-60"
            >
              <div className="font-medium">{school.school_name}</div>
              <div className="text-sm text-gray-500">
                {school.subdomain} · {school.role}
              </div>
            </button>
          ))}
        </div>
        {schools.length === 0 && (
          <p className="text-sm text-gray-500">{t("no_tenants")}</p>
        )}
      </div>
    </div>
  );
}
