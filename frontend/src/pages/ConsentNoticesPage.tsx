import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";

type ConsentNotice = {
  notice_id: string;
  notice_code: string;
  title: string;
  content_text: string;
  version: number;
  is_active: boolean;
  requires_renewal: boolean;
  renewal_period_days: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export default function ConsentNoticesPage() {
  const [notices, setNotices] = useState<ConsentNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    api.get<ConsentNotice[]>("/compliance/consent-notices")
      .then((res) => setNotices(res.data || []))
      .catch(() => setNotices([]))
      .finally(() => setLoading(false));
  }, []);

  const statusBadge = (isActive: boolean) => {
    return isActive
      ? <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span>
      : <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Inactive</span>;
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-heading mb-6">Consent Notices</h2>
          {loading ? (
            <Skeleton rows={5} columns={5} />
          ) : (
            <DataTable
              data={notices}
              columns={[
                { key: "notice_code", header: "Code", render: (r) => r.notice_code },
                { key: "title", header: "Title" },
                { key: "version", header: "Version", render: (r) => String(r.version) },
                { key: "requires_renewal", header: "Renewal Required", render: (r) => r.requires_renewal ? "Yes" : "No" },
                { key: "renewal_period_days", header: "Renewal Period (days)", render: (r) => r.renewal_period_days?.toString() || "—" },
                { key: "is_active", header: "Status", render: (r) => statusBadge(r.is_active) },
              ]}
            />
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}