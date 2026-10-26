import { useState } from "react";
import { useTranslation } from "react-i18next";
import Card from "../../components/atoms/Card";
import Input from "../../components/atoms/Input";
import Button from "../../components/atoms/Button";

export default function EvidenceCapturePage() {
  const { t } = useTranslation();
  const [tag, setTag] = useState("");
  const [holder, setHolder] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTag("");
    setHolder("");
    setLoading(false);
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-display font-display">{t("teacher.evidence_capture")}</h1>
          <p className="text-body">{t("teacher.evidence_capture_desc", { defaultMessage: "Record learner evidence and observations" })}</p>
        </div>
      </div>

      <Card className="p-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label={t("tag_uid")}
            placeholder="TAP123456"
            value={tag}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTag(e.target.value)}
          />
          <Input
            label={t("holder_name")}
            placeholder="Brian Omondi"
            value={holder}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHolder(e.target.value)}
          />
          <Button variant="primary" type="submit" fullWidth loading={loading}>
            {t("record")}
          </Button>
        </form>
      </Card>
    </div>
  );
}
