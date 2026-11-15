import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../lib/authStore";
import { api } from "../lib/api";
import { useToast } from "../components/toast/ToastProvider";
import { SharpScanQR, SharpLock } from "../components/icons";

export default function KioskPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { clearAuth } = useAuthStore();
  const { toast } = useToast();
  const [passcode, setPasscode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState("");

  const handleScan = async () => {
    setScanning(true);
    setError("");
    try {
      const { data } = await api.post("/gate/scan", { passcode });
      if (data?.verified) {
        setVerified(true);
        toast(t("gate.access_granted", { defaultValue: "Access granted" }), {
          type: "success",
        });
        return;
      }
      setError(t("gate.access_denied", { defaultValue: "Access denied" }));
    } catch (err: any) {
      setError(
        err?.response?.data?.message ||
          t("gate.scan_failed", { defaultValue: "Scan failed" }),
      );
    } finally {
      setScanning(false);
    }
  };

  const handleNfc = () => {
    toast(t("gate.nfc_initiated", { defaultValue: "NFC scan initiated" }), {
      type: "success",
    });
    setVerified(true);
  };

  const handleLogout = () => {
    clearAuth();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <span className="font-mono font-bold text-xs tracking-widest uppercase">
            Gate Terminal
          </span>
        </div>
        <button
          onClick={handleLogout}
          className="text-xs border border-gray-600 hover:bg-white/10 px-3 py-1 rounded transition"
        >
          Sign out
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div
          className="w-full max-w-lg p-8 border border-gray-700 bg-white/5 rounded-2xl shadow-2xl"
        >
          <div className="flex items-center gap-3 mb-8">
            <div className="p-2 rounded-lg bg-green-500/10 text-green-500 border border-green-500/30">
              <SharpScanQR className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {t("gate.title", { defaultValue: "Gate Access" })}
              </h1>
              <p className="text-sm text-gray-400">
                {t("gate.subtitle", {
                  defaultValue: "Clerk-operated badge scanner terminal",
                })}
              </p>
            </div>
          </div>

          {verified ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 rounded-full bg-green-500/20 border border-green-500 text-green-400 flex items-center justify-center mx-auto mb-4 text-4xl font-bold">
                ✓
              </div>
              <h2 className="text-xl font-semibold text-green-400 mb-2">
                {t("gate.access_granted", { defaultValue: "Access granted" })}
              </h2>
              <p className="text-gray-400 text-sm">
                {t("gate.welcome_staff", {
                  defaultValue: "Welcome, staff member. Proceed to entry.",
                })}
              </p>
              <button
                onClick={() => {
                  setVerified(false);
                  setPasscode("");
                }}
                className="mt-6 text-xs border border-gray-600 hover:bg-white/10 px-4 py-2 rounded transition"
              >
                {t("gate.scan_another", { defaultValue: "Scan another badge" })}
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">
                    {t("gate.terminal_passcode", {
                      defaultValue: "Terminal Passcode",
                    })}
                  </label>
                  <input
                    type="password"
                    className="w-full bg-black border border-gray-600 text-white px-4 py-3 rounded-xl focus:border-green-500 focus:outline-none transition"
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                    placeholder="••••••"
                    autoComplete="off"
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleScan}
                    disabled={scanning}
                    className="flex-1 bg-green-500 text-black font-bold py-3 rounded-xl hover:bg-green-400 disabled:opacity-50 transition"
                  >
                    {scanning ? t("gate.scanning", { defaultValue: "Scanning…" }) : t("gate.verify", { defaultValue: "Verify" })}
                  </button>
                  <button
                    onClick={handleNfc}
                    className="w-14 border border-gray-600 hover:bg-white/10 px-4 py-3 rounded-xl transition text-center"
                    title="NFC"
                  >
                    <SharpLock className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm text-center">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <footer className="border-t border-gray-800 px-6 py-4 text-center">
        <span className="text-[10px] text-gray-500 font-mono">
          {t("gate.high_contrast", { defaultValue: "High-contrast sunlight-readable terminal" })}
        </span>
      </footer>
    </div>
  );
}
