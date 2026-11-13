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
import { SCHOOL_ADMIN_ROLES } from "../lib/roles";
import { useToast } from "../components/toast/ToastProvider";

const roles = ["HEAD", "DEPUTY", "BURSAR", "CLERK", "TEACHER"];

export default function StaffPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { roles: userRoles } = useAuthStore();
  // Listing staff is open to clerks, but POST /staff is limited to school
  // administrators. Hide the action instead of letting it 403.
  const staffRoles = ["HEAD", "DEPUTY", "BURSAR", "CLERK", "TEACHER"];
  const canManageStaff = staffRoles.some((r) => SCHOOL_ADMIN_ROLES.includes(r as any));
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [open, setOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffRow | null>(null);
  const [form, setForm] = useState<StaffCreateRequest & { first_name: string; last_name: string; membership_id?: string }>({
    email: "", phone_number: "", role: "TEACHER", subjects: [], employment_date: "",
    first_name: "", last_name: "",
  });
  const [saving, setSaving] = useState(false);

  const loadStaff = async () => {
    const r = await api.get<StaffRow[]>("/staff");
    setStaff(Array.isArray(r.data) ? r.data : []);
    setState("content");
  };

  useEffect(() => {
    loadStaff().catch(() => setState("error"));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingStaff) {
        await api.patch(`/staff/${editingStaff.membership_id}`, form);
        toast("Staff member updated", { type: "success" });
      } else {
        await api.post("/staff", form);
        toast("Staff member created — an invite has been sent to their email/phone", { type: "success" });
      }
      setOpen(false);
      setEditingStaff(null);
      await loadStaff();
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to save staff", { type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (membershipId: string) => {
    if (!confirm("Deactivate this staff member? They will lose access to the school.")) return;
    try {
      await api.delete(`/staff/${membershipId}`);
      toast("Staff member deactivated", { type: "success" });
      await loadStaff();
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to deactivate", { type: "error" });
    }
  };

  const openCreate = () => {
    setEditingStaff(null);
    setForm({ email: "", phone_number: "", role: "TEACHER", subjects: [], employment_date: "", first_name: "", last_name: "" });
    setOpen(true);
  };

  const openEdit = (s: StaffRow) => {
    setEditingStaff(s);
    setForm({
      membership_id: s.membership_id,
      email: s.email,
      phone_number: s.phone_number,
      role: s.role,
      tsc_number: s.tsc_number || "",
      subjects: s.subjects || [],
      employment_date: s.employment_date || "",
      first_name: s.first_name || "",
      last_name: s.last_name || "",
    });
    setOpen(true);
  };

  if (state === "loading") return <ViewState state="loading" />;
  if (state === "error") return <ViewState state="error" onRetry={() => loadStaff()} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-display">{t("staff")}</h1>
          <p className="text-body">{t("staff_management.manage_staff_and_roles")}</p>
        </div>
        {canManageStaff && (
          <Button variant="primary" onClick={openCreate}>
            {t("add_staff")}
          </Button>
        )}
      </div>

      <Card>
        <DataTable
          data={staff}
          loading={false}
          columns={[
            { key: "first_name", header: t("first_name"), render: (row) => `${row.first_name || ""} ${row.last_name || ""}`.trim() || "—", sortable: true },
            { key: "email", header: t("email"), sortable: true },
            { key: "phone_number", header: t("phone"), sortable: true },
            { key: "role", header: t("role"), sortable: true },
            { key: "status", header: t("status"), render: (row) => <Badge variant="default">{row.status}</Badge>, sortable: true },
            { key: "tsc_number", header: "TSC No.", sortable: true },
            { key: "actions", header: "Actions", sortable: false, render: (row) => canManageStaff ? (
              <div className="flex gap-2">
                <button className="px-3 py-1 text-sm text-kenyan-red hover:underline" onClick={() => openEdit(row)}>Edit</button>
                {row.status === "ACTIVE" && <button className="px-3 py-1 text-sm text-red-600 hover:underline" onClick={() => handleDelete(row.membership_id)}>Deactivate</button>}
              </div>
            ) : (
              "—"
            )},
          ]}
          emptyMessage={t("no_staff")}
        />
      </Card>

      <Dialog open={open} onClose={() => { setOpen(false); setEditingStaff(null); }} title={editingStaff ? "Edit Staff" : t("add_staff")} className="max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <input
              id="first_name"
              type="text"
              className="input-field"
              placeholder="First Name"
              value={form.first_name}
              onChange={(e) => setForm({ ...form, first_name: e.target.value })}
              required
            />
            <input
              id="last_name"
              type="text"
              className="input-field"
              placeholder="Last Name"
              value={form.last_name}
              onChange={(e) => setForm({ ...form, last_name: e.target.value })}
              required
            />
          </div>
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
              placeholder="TSC number (optional)"
              value={form.tsc_number || ""}
              onChange={(e) => setForm({ ...form, tsc_number: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Subjects</label>
            <input
              id="subjects"
              type="text"
              className="input-field"
              placeholder="Comma-separated, e.g. Mathematics, English"
              value={(form.subjects || []).join(", ")}
              onChange={(e) => setForm({
                ...form,
                subjects: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
              })}
            />
          </div>
          <div>
            <label className="label">Employment Date</label>
            <input
              id="employment_date"
              type="date"
              className="input-field"
              value={form.employment_date}
              onChange={(e) => setForm({ ...form, employment_date: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" onClick={() => { setOpen(false); setEditingStaff(null); }}>{t("cancel")}</Button>
            <Button variant="primary" type="submit" loading={saving}>{t("save")}</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}