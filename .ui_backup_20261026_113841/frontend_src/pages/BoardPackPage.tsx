import { useState, useEffect } from "react";
import { api } from "../lib/api";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

const kes = (n: any) => `KES ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function BoardPackPage() {
  const [pack, setPack] = useState<any>(null);
  const [verification, setVerification] = useState<any>(null);
  const [integrity, setIntegrity] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    document.body.classList.add("printing-pack");
    Promise.all([
      api.get("/finance/board-pack"),
      api.get("/finance/ledger/verify"),
    ]).then(([p, v]) => {
      setPack(p.data?.pack || null);
      setVerification(p.data?.verification || null);
      setIntegrity(v.data || null);
    }).catch(() => {})
      .finally(() => setLoading(false));
    return () => document.body.classList.remove("printing-pack");
  }, []);

  const verifyCode = async () => {
    if (!verification?.code) return;
    try {
      await api.get(`/finance/board-pack/verify?code=${verification.code}`);
      toast("Verification stamp re-computed and matches the envelope", { type: "success" });
    } catch {
      toast("Verification failed", { type: "error" });
    }
  };

  const school = (() => { try { return localStorage.getItem("school_code") || "School"; } catch { return "School"; } })();

  if (loading) return <div className="min-h-screen bg-gray-50 p-6"><Skeleton rows={8} columns={3} /></div>;

  return (
    <div className="min-h-screen bg-gray-50 p-4 print:p-0">
      <div className="max-w-3xl mx-auto print-area">
        <div className="enterprise-card p-8 print:shadow-none print:border-slate-300">
          {/* Letterhead */}
          <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4 mb-5">
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight">Board Financial Summary</h1>
              <p className="text-xs text-gray-500 mt-1">
                {school.toString().toUpperCase()} · Generated {pack?.generated_at ? new Date(pack.generated_at).toLocaleString([], { dateStyle: "long", timeStyle: "short" }) : "—"} · for {pack?.generated_for}
              </p>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 blink-0">
                {integrity?.chain_head?.integrity === "VERIFIED" ? `Hash chain verified (${integrity.depth} events)` : "Chain integrity pending"}
              </div>
              <div className="text-[10px] text-gray-400 mt-1">Basic Education Act 2013 · s.56 reporting</div>
            </div>
          </div>

          {/* Account summary */}
          <table className="w-full text-sm mb-5">
            <tbody className="divide-y divide-slate-100">
              {[
                ["Enrolled learners", pack?.learners, false],
                ["Invoices issued", pack?.invoices, false],
                ["Total invoiced", kes(pack?.invoiced_total), true],
                ["Collected (ledger payments)", kes(pack?.collected_ledger), true],
                ["Collected (credited to invoices)", kes(pack?.collected_invoices), true],
                ["Outstanding (aging)", kes(pack?.outstanding), true],
                ["Invoices with balance", pack?.invoices_with_balance, false],
                ["Collection efficiency", `${pack?.collection_rate_percent ?? 0}%`, true],
              ].map(([label, value, mono]: any[], i) => (
                <tr key={i}>
                  <td className="py-2 text-gray-600">{label}</td>
                  <td className={`py-2 text-right font-bold ${mono ? "financial-data text-slate-900" : ""}`}>{String(value ?? "—")}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Verification block */}
          <div className="border border-slate-300 rounded-md p-4 text-xs">
            <div className="font-bold uppercase tracking-wider text-[10px] text-slate-500 mb-2">Document verification</div>
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <div className="text-gray-500">Verification code</div>
                <div className="financial-data font-black text-base text-slate-900">{verification?.code}</div>
              </div>
              <div className="ml-auto flex gap-2 no-print">
                <button
                  onClick={() => navigator.clipboard?.writeText(verification?.code || "").then(() => toast("Code copied", { type: "success" }))}
                  className="px-3 py-1.5 rounded-md border border-slate-300 font-bold hover:border-slate-500"
                >Copy stamp</button>
                <button onClick={verifyCode} className="px-3 py-1.5 rounded-md border border-slate-300 font-bold hover:border-slate-500">Re-verify</button>
                <button onClick={() => window.print()} className="px-3 py-1.5 rounded-md bg-slate-900 text-white font-bold hover:bg-slate-800">Print / Save PDF</button>
              </div>
            </div>
            <p className="text-[10px] text-gray-400 mt-2">
              Stamp method: {verification?.method}. An authenticated holder can re-run
              {" "}<span className="font-mono">GET /finance/board-pack/verify?code={verification?.code}</span> — any tampering with underlying
              finance records changes the recomputed code and invalidates this stamp. Every C2B receipt behind these figures is committed to
              an append-only HMAC-SHA256 hash chain (ledger seq + emerald row highlight in the M-Pesa Real-Time Ledger).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
