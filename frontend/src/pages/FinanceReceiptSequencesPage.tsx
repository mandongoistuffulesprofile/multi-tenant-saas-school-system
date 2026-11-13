import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Dialog from "../components/dialog/Dialog";
import HelpTip from "../components/atoms/HelpTip";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

type ReceiptSequence = {
  sequence_id: string;
  prefix: string;
  last_number: number;
  reset_frequency: string;
  current_period: string;
};

export default function FinanceReceiptSequencesPage() {
  const [sequences, setSequences] = useState<ReceiptSequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ReceiptSequence | null>(null);
  const [saving, setSaving] = useState(false);
  const { t } = useTranslation();
  const { toast } = useToast();

  const formInit = () => ({ prefix: "RCP", last_number: 0, reset_frequency: "YEARLY", current_period: "" });
  const [form, setForm] = useState<{ prefix: string; last_number: number; reset_frequency: string; current_period: string }>(formInit());

  useEffect(() => {
    api.get("/finance/receipt-sequences").then((res) => {
      setSequences(Array.isArray(res.data) ? res.data : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(formInit());
    setModalOpen(true);
  };

  const openEdit = (seq: ReceiptSequence) => {
    setEditing(seq);
    setForm({ prefix: seq.prefix, last_number: seq.last_number, reset_frequency: seq.reset_frequency, current_period: seq.current_period });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.prefix.trim() || !form.current_period.trim() || form.last_number < 0) {
      toast("Fill all required fields", { type: "error" });
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/finance/receipt-sequences/${editing.sequence_id}`, {
          prefix: form.prefix.trim(),
          last_number: form.last_number,
          reset_frequency: form.reset_frequency,
          current_period: form.current_period.trim(),
        });
        toast("Sequence updated", { type: "success" });
      } else {
        await api.post("/finance/receipt-sequences", {
          prefix: form.prefix.trim(),
          last_number: form.last_number,
          reset_frequency: form.reset_frequency,
          current_period: form.current_period.trim(),
        });
        toast("Sequence created", { type: "success" });
      }
      setModalOpen(false);
      setEditing(null);
      setForm(formInit());
      api.get("/finance/receipt-sequences").then((r) => setSequences(Array.isArray(r.data) ? r.data : []));
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to save", { type: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-heading">Receipt Sequences</h2>
            <button className="btn-primary" onClick={openCreate}>Add Sequence</button>
          </div>
          {loading ? (
            <Skeleton rows={5} columns={5} />
          ) : (
            <DataTable
              data={sequences}
              emptyMessage="No receipt sequences configured"
              columns={[
                { key: "prefix", header: "Prefix" },
                { key: "last_number", header: "Last Number", render: (r) => r.last_number?.toString().padStart(6, "0") },
                { key: "reset_frequency", header: "Reset Frequency" },
                { key: "current_period", header: "Current Period" },
                { key: "actions", header: "Actions", render: (r) => (
                  <div className="flex gap-2">
                    <button className="px-3 py-1 text-sm text-kenyan-red hover:underline" onClick={() => openEdit(r)}>Edit</button>
                  </div>
                )},
              ]}
            />
          )}
          <Dialog open={modalOpen} onClose={() => { setModalOpen(false); setEditing(null); setForm(formInit()); }} title={editing ? "Edit Sequence" : "Create Sequence"} className="max-w-md">
            <form onSubmit={handleSave}>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Prefix<HelpTip text="Prefix for generated receipt numbers (e.g., RCP, RCT)." /></span>
                <input
                  type="text"
                  required
                  maxLength={10}
                  value={form.prefix}
                  onChange={(e) => setForm({ ...form, prefix: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                />
              </label>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Last Number<HelpTip text="The last number used. Next receipt will be Last Number + 1." /></span>
                <input
                  type="number"
                  min="0"
                  required
                  value={form.last_number}
                  onChange={(e) => setForm({ ...form, last_number: parseInt(e.target.value, 10) || 0 })}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                />
              </label>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Reset Frequency</span>
                <select
                  value={form.reset_frequency}
                  onChange={(e) => setForm({ ...form, reset_frequency: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                >
                  <option value="YEARLY">Yearly</option>
                  <option value="MONTHLY">Monthly</option>
                  <option value="TERMLY">Termly</option>
                  <option value="NEVER">Never</option>
                </select>
              </label>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Current Period<HelpTip text="The period this sequence applies to (e.g., 2024, 2024-01, 2024-T1)." /></span>
                <input
                  type="text"
                  required
                  value={form.current_period}
                  onChange={(e) => setForm({ ...form, current_period: e.target.value })}
                  placeholder="e.g. 2024"
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                />
              </label>
              <div className="sticky bottom-0 flex justify-end gap-2 border-t border-gray-100 bg-white pt-4 pb-1">
                <button type="button" onClick={() => { setModalOpen(false); setEditing(null); setForm(formInit()); }} style={{ padding: "0.5rem 1rem" }}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? "Saving…" : editing ? "Update" : "Create"}
                </button>
              </div>
            </form>
          </Dialog>
        </div>
      </div>
    </ErrorBoundary>
  );
}