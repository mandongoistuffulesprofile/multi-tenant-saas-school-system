import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Card from "../../components/atoms/Card";
import Input from "../../components/atoms/Input";
import Button from "../../components/atoms/Button";
import { api } from "../../lib/api";

export default function ParentActivatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [claimCode, setClaimCode] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);
    setError(null);
    try {
      await api.post("/auth/parent/activate", {
        claim_code: claimCode,
        phone,
        new_password: password,
      });
      navigate("/login", { state: { activated: true } });
    } catch (err: any) {
      setError(err.response?.data?.message || t("errors.network_error", { defaultMessage: "Network error. Please check your connection." }));
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md p-6">
        <h1 className="text-display font-display text-center mb-6">{t("parent.activate_account", { defaultMessage: "Activate Account" })}</h1>
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label={t("parent.claim_code", { defaultMessage: "Claim Code" })}
            placeholder="SKL-XXXX"
            value={claimCode}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setClaimCode(e.target.value)}
            required
          />
          <Input label={t("phone")} type="tel" placeholder="07XXXXXXXX" value={phone} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)} required />
          <Input label={t("password")} type="password" value={password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} required />
          <Button variant="primary" type="submit" fullWidth loading={processing}>{t("activate", { defaultMessage: "Activate" })}</Button>
        </form>
        <p className="text-caption text-muted text-center mt-4">{t("parent.activation_help", { defaultMessage: "Claim code sent via SMS. Contact the school if you didn't receive one." })}</p>
      </Card>
    </div>
  );
}
