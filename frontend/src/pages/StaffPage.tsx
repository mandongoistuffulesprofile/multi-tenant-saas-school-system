import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../lib/authStore";
import { api } from "../lib/api";
import Card from "../components/atoms/Card";
import Badge from "../components/atoms/Badge";
import Button from "../components/atoms/Button";
import ViewState from "../components/organisms/ViewState";
import DataTable from "../components/organisms/DataTable";
import Dialog from "../components/dialog/Dialog";
import { StaffRow, StaffCreateRequest } from "../lib/types";

export default function StaffPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<StaffCreateRequest>({
    email: "", phone_number: "", role: "TEACHER", subjects: [], employment_date: "",
  });
  const [saving, setSaving] = useState(false);

  const roles = ["HEAD", "DEPUTY", "BURSAR", "CLERK", "TEACHER"];

  useEffect(() => {
    api.get<StaffRow[]>("/staff")
      .then((r) => { setStaff(Array.isArray(r.data) ? r.data : []); setState("content"); })
      .catch(() => setState("error"));
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    api.post("/staff", form)
      .then(() => { setOpen(false); api.get<StaffRow[]>("/staff").then((r) => setStaff(Array.isArray(r.data) ? r.data : [])); })
      .catch((err) => { alert(err.response?.data?.message || "Failed to save staff"); })
      .finally(() => setSaving(false));
  };

  if (state === "loading") return <ViewState state="loading" />;
  if (state === "error") return <ViewState state="error" onRetry={() => setState("loading")} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-display">{t("staff")}</h1>
          <p className="text-body">{t("staff_management.manage_staff_and_roles")}</p>
        </div>
        <Button variant="primary" onClick={() => { setForm({ email: "", phone_number: "", role: "TEACHER", subjects: [], employment_date: "" }); setOpen(true); }}>
          {t("add_staff")}
        </Button>
      </div>

      <Card>
        <DataTable
          data={staff}
          loading={false}
          columns={[
            { key: "email", header: t("email"), sortable: true },
            { key: "phone_number", header: t("phone"), sortable: true },
            { key: "role", header: t("role"), sortable: true },
            { key: "status", header: t("status"), render: (row) => <Badge variant="default">{row.status}</Badge>, sortable: true },
            { key: "tsc_number", header: "TSC No.", sortable: true },
          ]}
          emptyMessage={t("no_staff")}
        />
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} title={t("add_staff")} className="max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <input
              id="email"
              type="email"
              className="input-field"
              placeholder={t("email")}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
            <input
              id="phone"
              type="tel"
              className="input-field"
              placeholder={t("phone")}
              value={form.phone_number}
              onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label">{t("role")}</label>
            <select
              id="role"
              className="input-field"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as any })}
            >
              {roles.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">TSC Number</label>
            <input
              id="tsc"
              type="text"
              className="input-field"
              placeholder="TSC number"
              value={form.subjects ? "" : ""}
              
            />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" onClick={() => setOpen(false)}>{t("cancel")}</Button>
            <Button variant="primary" type="submit" loading={saving}>{t("save")}</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
