import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import Card from "../components/atoms/Card";
import { useToast } from "../components/toast/ToastProvider";

interface ImportRow {
  line: number;
  admission_number: string;
  status: "IMPORTABLE" | "DUPLICATE" | "INVALID";
  reasons?: string[];
}

interface ImportPreview {
  total_rows: number;
  importable: number;
  duplicates: number;
  invalid: number;
  rows: ImportRow[];
}

const SAMPLE = `admission_number,first_name,middle_name,last_name,grade_label,stream_name,guardian_phone
ADM-101,Amina,Wanjiru,Kamau,PP1,East,0712345678
ADM-102,Brian,,Otieno,Grade 1,West,0723456789`;

/**
 * Learner CSV intake. The preview is a server-side dry run: it reports which
 * rows will be created, which already exist, and which need fixing before
 * anything is written.
 */
export default function ImportLearnersPage() {
  const { toast } = useToast();
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);

  const submit = async (dryRun: boolean) => {
    if (!csv.trim()) {
      toast("Paste CSV rows or choose a file first.", { type: "error" });
      return;
    }
    setBusy(dryRun ? "preview" : "import");
    try {
      const res = await api.post("/imports/learners", { csv, dry_run: dryRun });
      setPreview(res.data.preview as ImportPreview);
      if (dryRun) {
        toast("Dry run complete — review the rows below.", { type: "success" });
      } else {
        toast(`Imported ${res.data.created ?? 0} learner(s).`, { type: "success" });
      }
    } catch (err: any) {
      toast(err.response?.data?.message || "Import request failed", { type: "error" });
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setCsv(await file.text());
    setPreview(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-display">Import learners</h1>
          <p className="text-body">
            Upload a CSV, dry-run it, then import only the rows that are ready.
          </p>
        </div>
        <Link to="/learners" className="text-sm font-medium text-kenyan-red hover:underline">
          Back to learners
        </Link>
      </div>

      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void onFile(e.target.files?.[0])}
            className="text-sm"
          />
          <button
            type="button"
            className="text-sm text-kenyan-red hover:underline"
            onClick={() => { setCsv(SAMPLE); setPreview(null); }}
          >
            Use sample rows
          </button>
        </div>
        <div>
          <label className="label" htmlFor="learner-csv">CSV content</label>
          <textarea
            id="learner-csv"
            className="input-field h-56 font-mono text-xs"
            value={csv}
            onChange={(e) => { setCsv(e.target.value); setPreview(null); }}
            placeholder="admission_number,first_name,middle_name,last_name,grade_label,stream_name,guardian_phone"
          />
          <p className="text-caption mt-1 text-gray-500">
            Required columns: admission_number, first_name, last_name and grade_label.
            Stream and guardian phone are optional.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            disabled={busy !== null}
            onClick={() => void submit(true)}
          >
            {busy === "preview" ? "Checking…" : "Preview (dry run)"}
          </button>
          <button
            type="button"
            className="rounded-lg bg-kenyan-red px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            disabled={busy !== null || !preview || preview.importable === 0}
            onClick={() => void submit(false)}
          >
            {busy === "import" ? "Importing…" : `Import ${preview?.importable ?? 0} row(s)`}
          </button>
        </div>
      </Card>

      {preview && (
        <Card className="p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Rows", preview.total_rows],
              ["Ready", preview.importable],
              ["Duplicates", preview.duplicates],
              ["Invalid", preview.invalid],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <p className="text-caption uppercase tracking-wide text-gray-500">{label}</p>
                <p className="text-2xl font-bold text-gray-900">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-xs font-medium uppercase text-gray-500">Line</th>
                  <th className="px-3 py-2 text-xs font-medium uppercase text-gray-500">Admission no.</th>
                  <th className="px-3 py-2 text-xs font-medium uppercase text-gray-500">Status</th>
                  <th className="px-3 py-2 text-xs font-medium uppercase text-gray-500">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.rows.map((row, i) => (
                  <tr key={`${row.line}-${row.admission_number}-${i}`}>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500">{row.line}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.admission_number || "—"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          row.status === "IMPORTABLE"
                            ? "bg-green-100 text-green-800"
                            : row.status === "DUPLICATE"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-red-100 text-red-800"
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {row.reasons?.join("; ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
