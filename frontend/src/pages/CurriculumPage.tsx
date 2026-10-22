import { useState, useEffect } from "react";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";

export default function CurriculumPage() {
  const [versions, setVersions] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/curriculum/versions").then((res) => {
      const list = res.data || [];
      setVersions(list);
      if (list.length > 0) {
        setSelectedVersion(list[0].version_id);
        loadAreas(list[0].version_id);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const loadAreas = (versionId: string) => {
    api.get(`/curriculum/areas?version_id=${versionId}`).then((res) => {
      setAreas(res.data || []);
    }).catch(() => setAreas([]));
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-heading mb-6">Curriculum</h2>
          {loading ? (
            <Skeleton rows={5} columns={4} />
          ) : (
            <>
              <div className="card p-6 mb-6">
                <label className="label">Curriculum Version</label>
                <select
                  className="input-field max-w-xs"
                  value={selectedVersion}
                  onChange={(e) => {
                    setSelectedVersion(e.target.value);
                    loadAreas(e.target.value);
                  }}
                >
                  {versions.map((v) => (
                    <option key={v.version_id} value={v.version_id}>
                      {v.version_label} ({v.is_published ? "Published" : "Draft"})
                    </option>
                  ))}
                </select>
              </div>
              <DataTable
                data={areas}
                emptyMessage="No learning areas found"
                columns={[
                  { key: "code", header: "Code" },
                  { key: "name", header: "Name" },
                  { key: "grade_band", header: "Grade Band", render: (r) => r.grade_band || "—" },
                  { key: "sort_order", header: "Sort" },
                ]}
              />
            </>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}