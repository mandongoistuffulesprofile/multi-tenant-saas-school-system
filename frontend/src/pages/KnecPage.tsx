import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

export default function KnecPage() {
  const [tools, setTools] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [exports, setExports] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [assessmentType, setAssessmentType] = useState("KPSEA");
  const [assessmentYear, setAssessmentYear] = useState(new Date().getFullYear());
  const [importText, setImportText] = useState("");
  const { t } = useTranslation();
  const { toast } = useToast();

  useEffect(() => {
    Promise.all([
      api.get("/knec/tools"),
      api.get("/knec/submissions"),
      api.get("/knec/exports"),
      api.get("/knec/results").catch(() => ({ data: [] })),
    ]).then(([tRes, sRes, eRes, rRes]) => {
      setTools(tRes.data || []);
      setSubmissions(sRes.data || []);
      setExports(eRes.data || []);
      setResults(rRes.data || []);
    }).catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const reloadResults = async () => {
    try {
      const res = await api.get("/knec/results");
      setResults(Array.isArray(res.data) ? res.data : []);
    } catch { /* keep current list */ }
  };

  const handleImport = async () => {
    const rows = importText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^admission/i.test(line))
      .map((line) => {
        const [admission_number, subject_code, raw_band] = line.split(/[,\t]/).map((part) => part.trim());
        return { admission_number, subject_code: subject_code || "", raw_band: raw_band || subject_code || "" };
      });
    if (rows.length === 0) {
      toast("Paste at least one row: admission number, subject code, raw band.", { type: "error" });
      return;
    }
    setImporting(true);
    try {
      const res = await api.post("/knec/results/import", {
        assessment_type: assessmentType,
        assessment_year: assessmentYear,
        results: rows,
      });
      toast(`Imported ${res.data?.imported ?? 0}, unchanged ${res.data?.skipped ?? 0}`, { type: "success" });
      setImportText("");
      await reloadResults();
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to import KNEC results", { type: "error" });
    } finally {
      setImporting(false);
    }
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-heading mb-6">KNEC</h2>
          {loading ? (
            <Skeleton rows={5} columns={4} />
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div className="card p-6">
                  <h3 className="text-caption uppercase tracking-wide mb-2">Tools</h3>
                  <p className="text-3xl font-bold text-kenyan-red">{tools.length}</p>
                </div>
                <div className="card p-6">
                  <h3 className="text-caption uppercase tracking-wide mb-2">Submissions</h3>
                  <p className="text-3xl font-bold text-kenyan-green">{submissions.length}</p>
                </div>
                <div className="card p-6">
                  <h3 className="text-caption uppercase tracking-wide mb-2">Exports</h3>
                  <p className="text-3xl font-bold text-gray-900">{exports.length}</p>
                </div>
              </div>
              <div className="card p-6 mb-6">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h3 className="text-caption uppercase tracking-wide">Official KNEC Results</h3>
                    <p className="text-xs text-gray-500 mt-1">
                      Raw bands only. KPSEA and Grade 3 use EE–BE; KJSEA uses EE1–BE2. Imports are append-only revisions.
                    </p>
                  </div>
                  <button className="btn-secondary" onClick={reloadResults}>Refresh</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  <label className="text-sm">
                    <span className="block font-medium mb-1">Assessment</span>
                    <select
                      className="w-full border border-gray-300 rounded-lg p-2"
                      value={assessmentType}
                      onChange={(e) => setAssessmentType(e.target.value)}
                    >
                      <option value="KPSEA">KPSEA (Grade 6)</option>
                      <option value="KJSEA">KJSEA (Grade 9)</option>
                      <option value="GRADE3">Grade 3 National Assessment</option>
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="block font-medium mb-1">Year</span>
                    <input
                      type="number"
                      className="w-full border border-gray-300 rounded-lg p-2"
                      value={assessmentYear}
                      onChange={(e) => setAssessmentYear(Number(e.target.value))}
                    />
                  </label>
                  <div className="flex items-end">
                    <button className="btn-primary w-full" onClick={handleImport} disabled={importing}>
                      {importing ? "Importing…" : "Import bands"}
                    </button>
                  </div>
                </div>
                <label className="text-sm block">
                  <span className="block font-medium mb-1">
                    Rows: admission number, subject code, raw band
                  </span>
                  <textarea
                    rows={4}
                    className="w-full border border-gray-300 rounded-lg p-2 font-mono text-xs"
                    placeholder={"ADM-001, MAT, ME1\nADM-001, ENG, EE2"}
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                  />
                </label>
              </div>

              <DataTable
                data={results}
                emptyMessage="No official national results imported yet"
                columns={[
                  { key: "learner_name", header: "Learner", render: (r) => r.learner_name || r.admission_number || r.learner_id },
                  { key: "assessment_type", header: "Assessment", render: (r) => `${r.assessment_type} ${r.assessment_year || ""}` },
                  { key: "subject_name", header: "Subject", render: (r) => r.subject_name || r.subject_code || "Overall" },
                  { key: "raw_band", header: "Official Band", render: (r) => <span className="font-bold">{r.raw_band}</span> },
                  { key: "descriptor", header: "Descriptor" },
                  { key: "revision", header: "Rev" },
                ]}
              />

              <DataTable
                data={tools}
                columns={[
                  { key: "tool_code", header: "Tool Code" },
                  { key: "name", header: "Name" },
                  { key: "category", header: "Category", render: (r) => r.category || "—" },
                  { key: "status", header: "Status" },
                ]}
              />
            </>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}