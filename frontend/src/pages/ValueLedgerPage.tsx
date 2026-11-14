import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import Skeleton from "../components/atoms/Skeleton";
import Button from "../components/atoms/Button";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";

/**
 * Value ledger: what the school owns and owes, in one place.
 *
 * Revenue and expenses come from posted journal entries up to today, so the net
 * position is the school's actual surplus for the period rather than a cash
 * balance. Outstanding fees are the open balances of issued invoices, and
 * inventory value is what is still in the store at its recorded cost.
 */
type Metrics = {
  total_revenue: number;
  total_expenses: number;
  net_position: number;
  outstanding_fees: number;
  inventory_value: number;
  student_count: number;
};

const money = (value: number | undefined) =>
  `KES ${Number(value || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ValueLedgerPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .get("/value-ledger/metrics")
      .then((res) => setMetrics(res.data))
      .catch((err) => {
        // The endpoint used to answer with zeros when it could not read the
        // ledger. A visible failure is better than a confident 0.
        setError(err?.response?.data?.message || "Could not load the value ledger");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const surplus = Number(metrics?.net_position || 0) >= 0;

  const cards: { label: string; value: string; hint: string; tone?: string }[] = [
    {
      label: "Revenue",
      value: money(metrics?.total_revenue),
      hint: "Credits posted to the ledger up to today",
    },
    {
      label: "Expenses",
      value: money(metrics?.total_expenses),
      hint: "Debits posted to the ledger up to today",
    },
    {
      label: "Net position",
      value: money(metrics?.net_position),
      hint: surplus ? "Surplus for the period" : "Deficit for the period",
      tone: surplus ? "text-green-700" : "text-kenyan-red",
    },
    {
      label: "Outstanding fees",
      value: money(metrics?.outstanding_fees),
      hint: "Open balances on issued, part-paid and overdue invoices",
    },
    {
      label: "Inventory value",
      value: money(metrics?.inventory_value),
      hint: "Remaining stock at its recorded unit cost",
    },
    {
      label: "Active learners",
      value: Number(metrics?.student_count || 0).toLocaleString("en-KE"),
      hint: "Learners currently on the roll",
    },
  ];

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-heading">Value Ledger</h2>
            <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
              Refresh
            </Button>
          </div>
          <p className="text-sm text-gray-500 mb-6">
            What the school has earned, spent and is still owed. Figures cover this school only
            and are taken from posted entries up to today.
          </p>

          {loading && <Skeleton rows={3} columns={3} />}

          {!loading && error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-medium text-kenyan-red">{error}</p>
              <p className="text-xs text-gray-600 mt-1">
                The ledger could not be read. Nothing is shown rather than showing zeros.
              </p>
              <div className="mt-3">
                <Button variant="secondary" size="sm" onClick={load}>
                  Try again
                </Button>
              </div>
            </div>
          )}

          {!loading && !error && metrics && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {cards.map((card) => (
                  <div key={card.label} className="bg-white rounded-lg border border-gray-200 p-5">
                    <p className="text-xs uppercase tracking-wide text-gray-500">{card.label}</p>
                    <p className={`mt-2 text-2xl font-semibold ${card.tone || "text-gray-900"}`}>
                      {card.value}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">{card.hint}</p>
                  </div>
                ))}
              </div>
              <p className="mt-6 text-xs text-gray-500">
                Outstanding fees count issued, part-paid and overdue invoices. Paid and void
                invoices are excluded, and prepayments held on account are not netted off here —
                see Credits for money the school is still holding.
              </p>
            </>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
