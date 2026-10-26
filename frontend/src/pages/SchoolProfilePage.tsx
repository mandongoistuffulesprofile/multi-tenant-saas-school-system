import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

export default function SchoolProfilePage() {
  const handleSaveProfile = async (updates: any) => {
    try {
      await api.patch("/school", updates);
      toast("School profile saved successfully!", { type: "success" });
    } catch {
      toast("Failed to update school profile", { type: "error" });
    }
  };

  const [school, setSchool] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();
  const { toast } = useToast();

  useEffect(() => {
    api.get("/school").then((res) => {
      setSchool(res.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-3xl mx-auto">
          <div className="card p-6 animate-pulse space-y-4">
            <div className="h-6 bg-gray-200 rounded w-1/3"></div>
            <div className="grid grid-cols-2 gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                  <div className="h-5 bg-gray-100 rounded w-full"></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );

  if (!school) return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-3xl mx-auto">
          <div className="card p-8 text-center">
            <span className="text-4xl"></span>
            <p className="text-body mt-4">School not found</p>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-heading mb-6">School Profile</h2>
          <div className="card p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <span className="text-caption uppercase tracking-wide">School Name</span>
                <p className="text-gray-900 mt-1">{school.school_name}</p>
              </div>
              <div>
                <span className="text-caption uppercase tracking-wide">Subdomain</span>
                <p className="text-gray-900 mt-1">{school.subdomain}.skulapp.ke</p>
              </div>
              <div>
                <span className="text-caption uppercase tracking-wide">School Type</span>
                <p className="text-gray-900 mt-1">{school.school_type || "—"}</p>
              </div>
              <div>
                <span className="text-caption uppercase tracking-wide">Funding Mode</span>
                <p className="text-gray-900 mt-1">{school.funding_mode || "—"}</p>
              </div>
              <div>
                <span className="text-caption uppercase tracking-wide">County</span>
                <p className="text-gray-900 mt-1">{school.county || "—"}</p>
              </div>
              <div>
                <span className="text-caption uppercase tracking-wide">License Tier</span>
                <p className="text-gray-900 mt-1">{school?.license_tier ?? "—"}</p>
              </div>
              <div>
                <span className="text-caption uppercase tracking-wide">Status</span>
                <p className={`mt-1 font-medium ${school?.status === "ACTIVE" ? "text-kenyan-green" : "text-kenyan-red"}`}>
                  {school?.status ?? "—"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}