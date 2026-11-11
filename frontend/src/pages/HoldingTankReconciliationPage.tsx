import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";
import Button from "../components/atoms/Button";
import { Learner } from "../lib/types";

interface HoldingEntry {
  id: string;
  tenant_id: string;
  msisdn: string;
  amount: number;
  reference: string;
  status: string;
  allocated_to?: string | null;
  allocated_at?: string | null;
  created_at: string;
}

export default function HoldingTankReconciliationPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [entries, setEntries] = useState<HoldingEntry[]>([]);
  const [learners, setLearners] = useState<Learner[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<Set<string>>(new Set());
  const [selectedLearner, setSelectedLearner] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get<HoldingEntry[]>("/holding-tank"),
      api.get<Learner[]>("/learners"),
    ])
      .then(([eRes, lRes]) => {
        if (!alive) return;
        setEntries(Array.isArray(eRes.data) ? eRes.data : []);
        setLearners(Array.isArray(lRes.data) ? lRes.data : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const pending = entries.filter((e) => String(e.status).toUpperCase() !== "ALLOCATED");

  const handleResolve = async (entryId: string) => {
    const studentId = selectedLearner[entryId];
    if (!studentId) {
      toast("Select a learner to allocate this payment to", { type: "error" });
      return;
    }
    setResolving((s) => new Set([...s, entryId]));
    try {
      await api.post(`/holding-tank/${entryId}/resolve`, { student_id: studentId });
      toast("Payment allocated to learner", { type: "success" });
      setSelectedLearner((s) => {
        const n = { ...s };
        delete n[entryId];
        return n;
      });
      setEntries((es) =>
        es.map((e) =>
          e.id === entryId ? { ...e, status: "ALLOCATED", allocated_to: studentId } : e
        )
      );
    } catch (err: any) {
      toast(err?.response?.data?.message || "Failed to allocate payment", {
        type: "error",
      });
    } finally {
      setResolving((s) => {
        const n = new Set(s);
        n.delete(entryId);
        return n;
      });
    }
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-heading">Holding Tank Reconciliation</h2>
            <p className="text-sm text-gray-600">
              Unmatched M-PESA payments awaiting allocation to a learner.
            </p>
          </div>
          {loading ? (
            <Skeleton rows={6} columns={7} />
          ) : (
            <DataTable
              data={entries}
              loading={loading}
              emptyMessage="No holding-tank entries"
              columns={[
                { key: "reference", header: "Reference", sortable: true },
                { key: "msisdn", header: "MSISDN", sortable: true },
                {
                  key: "amount",
                  header: "Amount (KES)",
                  sortable: true,
                  render: (r) => (r.amount != null ? r.amount.toLocaleString() : "—"),
                },
                {
                  key: "status",
                  header: "Status",
                  sortable: true,
                  render: (r) =>
                    String(r.status).charAt(0).toUpperCase() +
                    String(r.status).slice(1),
                },
                {
                  key: "created_at",
                  header: "Received",
                  sortable: true,
                  render: (r) => r.created_at,
                },
                {
                  key: "allocated_to",
                  header: "Allocated To",
                  render: (r) =>
                    r.allocated_to ||
                    (String(r.status).toUpperCase() === "ALLOCATED"
                      ? "—"
                      : "unallocated"),
                },
                {
                  key: "action",
                  header: "Allocate",
                  sortable: false,
                  render: (r) => {
                    const done = String(r.status).toUpperCase() === "ALLOCATED";
                    if (done) return <span className="text-xs text-gray-500">Allocated</span>;
                    return (
                      <div className="flex items-center gap-2">
                        <select
                          className="input-field text-xs border border-gray-300 rounded px-2 py-1"
                          value={selectedLearner[r.id] || ""}
                          onChange={(e) =>
                            setSelectedLearner((s) => ({
                              ...s,
                              [r.id]: e.target.value,
                            }))
                          }
                        >
                          <option value="">Select learner…</option>
                          {learners.map((l) => (
                            <option key={l.learner_id} value={l.learner_id}>
                              {l.admission_number} — {l.first_name} {l.last_name}
                            </option>
                          ))}
                        </select>
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={resolving.has(r.id)}
                          onClick={() => handleResolve(r.id)}
                          disabled={!selectedLearner[r.id] || resolving.has(r.id)}
                        >
                          Allocate
                        </Button>
                      </div>
                    );
                  },
                },
              ]}
            />
          )}
          {pending.length > 0 && (
            <div className="mt-4 text-xs text-gray-500">
              {pending.length} unallocated payment(s) awaiting reconciliation.
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
