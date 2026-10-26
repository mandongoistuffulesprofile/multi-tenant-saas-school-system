import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import Dialog from "../components/dialog/Dialog";
import Button from "../components/atoms/Button";

export default function FinanceFeeStructuresPage() {
  const [structures, setStructures] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    academic_year_id: "", grade_id: "", category_id: "",
    amount_per_term: "", amount_per_year: "", currency: "KES",
    is_mandatory: true, payment_frequency: "PER_TERM", due_day: "5",
  });
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    Promise.all([
      api.get("/finance/fee-structures").then((r) => setStructures(r.data || [])),
      api.get("/finance/fee-categories").then((r) => setCategories(r.data || [])),
    ]).finally(() => setLoading(false));
  }, []);

  const refresh = () => api.get("/finance/fee-structures").then((r) => setStructures(r.data || []));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    api.post("/finance/fee-structures", {
      ...form,
      amount_per_term: Number(form.amount_per_term),
      amount_per_year: Number(form.amount_per_year),
      due_day: Number(form.due_day),
    }).then(() => { setOpen(false); refresh(); })
      .catch(() => {})
      .finally(() => setSaving(false));
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
            <h2 className="text-heading">Fee Structures</h2>
            <Button variant="primary" onClick={() => setOpen(true)}>Add Fee Structure</Button>
          </div>
          {loading ? (
            <Skeleton rows={5} columns={6} />
          ) : (
            <>
              <DataTable
                data={structures}
                emptyMessage="No fee structures found"
                columns={[
                  { key: "grade_id", header: "Grade" },
                  { key: "category_code", header: "Category" },
                  { key: "amount_per_term", header: "Per Term", render: (r) => r.amount_per_term != null ? `KES ${r.amount_per_term}` : "—" },
                  { key: "amount_per_year", header: "Per Year", render: (r) => r.amount_per_year != null ? `KES ${r.amount_per_year}` : "—" },
                  { key: "payment_frequency", header: "Frequency", render: (r) => r.payment_frequency || "—" },
                  { key: "is_mandatory", header: "Mandatory", render: (r) => r.is_mandatory ? "Yes" : "No" },
                ]}
              />
              <Dialog open={open} onClose={() => setOpen(false)} title="Add Fee Structure" className="max-w-lg">
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="label">Category</label>
                    <select className="input-field" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} required>
                      <option value="">Select category…</option>
                      {categories.map((c) => <option key={c.category_id} value={c.category_id}>{c.name} ({c.code})</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="label">Grade ID</label>
                      <input className="input-field" value={form.grade_id} onChange={(e) => setForm({ ...form, grade_id: e.target.value })} required />
                    </div>
                    <div>
                      <label className="label">Academic Year ID</label>
                      <input className="input-field" value={form.academic_year_id} onChange={(e) => setForm({ ...form, academic_year_id: e.target.value })} required />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="label">Amount Per Term (KES)</label>
                      <input type="number" className="input-field" value={form.amount_per_term} onChange={(e) => setForm({ ...form, amount_per_term: e.target.value })} required />
                    </div>
                    <div>
                      <label className="label">Amount Per Year (KES)</label>
                      <input type="number" className="input-field" value={form.amount_per_year} onChange={(e) => setForm({ ...form, amount_per_year: e.target.value })} required />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="label">Payment Frequency</label>
                      <select className="input-field" value={form.payment_frequency} onChange={(e) => setForm({ ...form, payment_frequency: e.target.value })}>
                        <option value="PER_TERM">Per Term</option>
                        <option value="PER_YEAR">Per Year</option>
                        <option value="ONCE">Once</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Due Day</label>
                      <input type="number" className="input-field" value={form.due_day} onChange={(e) => setForm({ ...form, due_day: e.target.value })} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="mandatory" checked={form.is_mandatory} onChange={(e) => setForm({ ...form, is_mandatory: e.target.checked })} />
                    <label htmlFor="mandatory" className="label">Mandatory</label>
                  </div>
                  <div className="flex justify-end gap-2 pt-4">
                    <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
                    <Button variant="primary" type="submit" loading={saving}>Save</Button>
                  </div>
                </form>
              </Dialog>
            </>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}