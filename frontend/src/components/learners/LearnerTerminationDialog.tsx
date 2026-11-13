import React, { useEffect, useRef, useState } from "react";
import Dialog from "../../components/dialog/Dialog";
import Button from "../../components/atoms/Button";
import { FormField } from "../../components/molecules/FormField";
import { useTranslation } from "react-i18next";

const TERMINATION_CATEGORIES = [
  { value: "TRANSFERRED_OUT", label: "Transferred out" },
  { value: "EXPELLED", label: "Expelled" },
  { value: "GRADUATED", label: "Graduated / promoted out" },
  { value: "WITHDRAWN", label: "Withdrawn" },
  { value: "RELOCATED", label: "Relocated" },
  { value: "ARCHIVED", label: "Archived" },
] as const;

type TerminationCategory = (typeof TERMINATION_CATEGORIES)[number]["value"];

interface Props {
  open: boolean;
  onClose: () => void;
  learnerIds: string[];
  onConfirm: (category: TerminationCategory, reason: string) => Promise<void>;
  loading: boolean;
  selectedCount: number;
  firstConfirmRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export function LearnerTerminationDialog({
  open,
  onClose,
  learnerIds,
  onConfirm,
  loading,
  selectedCount,
  firstConfirmRef,
}: Props) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<TerminationCategory | "">("");
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const focusedRef = firstConfirmRef ?? textareaRef;

  useEffect(() => {
    if (open) {
      setCategory("");
      setReason("");
      setSubmitted(false);
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      setTimeout(() => focusedRef.current?.focus(), 0);
    }
  }, [open]);

  const canConfirm = category !== "" && reason.trim().length >= 10;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setSubmitted(true);
    try {
      await onConfirm(category, reason.trim());
    } finally {
      setSubmitted(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        setSubmitted(false);
        onClose();
      }}
      title={t("terminate_learner")}
      className="max-w-xl"
      initialFocusRef={focusedRef}
      returnFocusRef={firstConfirmRef ?? textareaRef}
    >
      <div className="space-y-5">
        <p className="text-sm text-slate-700">
          {selectedCount > 0 &&
            `${selectedCount} learner record(s) will be marked as no longer active. This does not delete the record.`}
        </p>

        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 space-y-2">
          <p className="text-sm font-medium text-amber-900">
            {t("terminate_learner_warning")}
          </p>
          <ul className="text-sm text-amber-900 space-y-1 list-disc list-inside">
            <li>The learner record is retained for audit and recordkeeping.</li>
            <li>Choose the category that best describes why the learner is leaving.</li>
            <li>Enter a short reason. This is recorded with the change.</li>
          </ul>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="label">{t("termination_category")}</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {TERMINATION_CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className={`rounded-xl border-2 p-3 text-left text-sm transition-colors ${
                    category === c.value
                      ? "border-kenyan-red bg-red-50 text-kenyan-red font-medium"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                  }`}
                  onClick={() => setCategory(c.value)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <FormField label={t("termination_reason")} required>
            <textarea
              ref={textareaRef}
              className="input-field min-h-[96px] resize-y"
              placeholder={t("termination_reason_placeholder")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="text-xs text-slate-500 mt-1">
              {reason.length}/10 minimum characters
            </p>
          </FormField>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
          <Button variant="secondary" onClick={onClose} disabled={loading || submitted}>
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={handleConfirm}
            disabled={!canConfirm || loading || submitted}
            loading={loading}
          >
            {submitted ? t("processing") : t("confirm_termination")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
