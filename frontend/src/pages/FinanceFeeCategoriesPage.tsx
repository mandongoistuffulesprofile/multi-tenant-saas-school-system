import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { toast } from "../lib/toast";
import { FeeCategory, FeeCategoryRequest } from "../lib/types";
import Card from "../components/atoms/Card";
import Badge from "../components/atoms/Badge";
import Button from "../components/atoms/Button";
import Input from "../components/atoms/Input";
import Dialog from "../components/dialog/Dialog";
import ViewState from "../components/organisms/ViewState";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";

const emptyForm: FeeCategoryRequest = {
  code: "",
  name: "",
  description: "",
  is_tuition: false,
  is_optional: true,
  requires_consent: false,
  is_active: true,
};

/**
 * Manages the school's own fee types.
 *
 * The eight global categories (tuition, boarding, meals, ...) are available to
 * every school and are read-only. A school can add its own categories — for
 * example a lunch programme levy or a swimming fee — and those are only
 * visible to that school.
 */
export default function FinanceFeeCategoriesPage() {
  const { t } = useTranslation();
  const [categories, setCategories] = useState<FeeCategory[]>([]);
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [editing, setEditing] = useState<FeeCategory | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FeeCategoryRequest>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<FeeCategory[]>("/finance/fee-categories");
      setCategories(Array.isArray(data) ? data : []);
      setState("content");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFieldErrors({});
    setOpen(true);
  };

  const openEdit = (category: FeeCategory) => {
    setEditing(category);
    setForm({
      code: category.code,
      name: category.name,
      description: category.description ?? "",
      is_tuition: category.is_tuition,
      is_optional: category.is_optional,
      requires_consent: category.requires_consent,
      is_active: category.is_active ?? true,
    });
    setFieldErrors({});
    setOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFieldErrors({});

    const request: FeeCategoryRequest = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      description: form.description?.trim() ?? "",
      is_tuition: !!form.is_tuition,
      is_optional: !!form.is_optional,
      requires_consent: !!form.requires_consent,
    };

    try {
      if (editing) {
        await api.patch(`/finance/fee-categories/${editing.category_id}`, request);
        toast(t("updated_at"), { type: "success" });
      } else {
        await api.post("/finance/fee-categories", request);
        toast(t("success"), { type: "success" });
      }
      setOpen(false);
      await load();
    } catch (err: any) {
      const data = err?.response?.data;
      if (Array.isArray(data?.field_errors)) {
        const map: Record<string, string> = {};
        for (const fe of data.field_errors) map[fe.field] = fe.message;
        setFieldErrors(map);
      } else {
        toast(data?.message || t("errors.network_error"), {
          type: "error",
          title: t("error"),
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (category: FeeCategory) => {
    try {
      await api.delete(`/finance/fee-categories/${category.category_id}`);
      toast(t("success"), { type: "success" });
      await load();
    } catch (err: any) {
      toast(err?.response?.data?.message || t("errors.network_error"), {
        type: "error",
        title: t("error"),
      });
    }
  };

  if (state === "loading") return <ViewState state="loading" />;
  if (state === "error") {
    return <ViewState state="error" onRetry={() => { setState("loading"); load(); }} />;
  }

  const globalCategories = categories.filter((c) => !c.is_custom);
  const customCategories = categories.filter((c) => c.is_custom);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-heading">{t("fee_categories")}</h2>
              <p className="text-body">{t("fee_categories_description")}</p>
            </div>
            <Button variant="primary" onClick={openCreate}>
              {t("add_fee_category")}
            </Button>
          </div>

          <Card title={t("custom_fee_categories")}>
            {customCategories.length === 0 ? (
              <p className="text-sm text-gray-500">{t("no_custom_fee_categories")}</p>
            ) : (
              <ul className="divide-y divide-gray-200">
                {customCategories.map((category) => (
                  <li
                    key={category.category_id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <div className="font-medium">
                        {category.name}{" "}
                        <span className="text-xs text-gray-500">({category.code})</span>
                      </div>
                      {category.description && (
                        <p className="text-sm text-gray-500">{category.description}</p>
                      )}
                      <div className="mt-1 flex gap-2">
                        {category.is_tuition && <Badge variant="info">{t("is_tuition")}</Badge>}
                        {category.is_optional && <Badge variant="default">{t("is_optional")}</Badge>}
                        {category.requires_consent && (
                          <Badge variant="warning">{t("requires_consent")}</Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" size="sm" onClick={() => openEdit(category)}>
                        {t("edit")}
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => handleDelete(category)}>
                        {t("deactivate")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t("standard_fee_categories")}>
            <ul className="divide-y divide-gray-200">
              {globalCategories.map((category) => (
                <li
                  key={category.category_id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3"
                >
                  <div>
                    <div className="font-medium">
                      {category.name}{" "}
                      <span className="text-xs text-gray-500">({category.code})</span>
                    </div>
                    {category.description && (
                      <p className="text-sm text-gray-500">{category.description}</p>
                    )}
                  </div>
                  <Badge variant="default">{t("standard")}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title={editing ? t("edit_fee_category") : t("add_fee_category")}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label={t("code")}
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              error={fieldErrors.code}
              placeholder="SWIMMING"
              required
            />
            <Input
              label={t("name")}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              error={fieldErrors.name}
              placeholder={t("swimming_lessons")}
              required
            />
            <Input
              label={t("description")}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              error={fieldErrors.description}
            />

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={!!form.is_tuition}
                onChange={(e) => setForm({ ...form, is_tuition: e.target.checked })}
              />
              {t("is_tuition")}
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={!!form.is_optional}
                onChange={(e) => setForm({ ...form, is_optional: e.target.checked })}
              />
              {t("is_optional")}
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={!!form.requires_consent}
                onChange={(e) => setForm({ ...form, requires_consent: e.target.checked })}
              />
              {t("requires_consent")}
            </label>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                {t("cancel")}
              </Button>
              <Button type="submit" variant="primary" loading={saving}>
                {t("save")}
              </Button>
            </div>
          </form>
        </Dialog>
      </div>
    </ErrorBoundary>
  );
}
