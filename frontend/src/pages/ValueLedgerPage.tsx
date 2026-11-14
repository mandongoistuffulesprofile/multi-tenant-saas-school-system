import { useCallback, useEffect, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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

type TrendPoint = {
  period: string; // YYYY-MM
  revenue: number;
  expenses: number;
  net: number;
};

const monthLabel = (period: string) => {
  const [year, month] = period.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("en-KE", { month: "short", year: "2-digit" });
};

const RANGES = [3, 6, 12, 24] as const;

const compact = (value: number) =>
  value >= 1000 ? `${Math.round(value / 1000)}k` : String(Math.round(value));

const money = (value: number | undefined) =>
  `KES ${Number(value || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ValueLedgerPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [months, setMonths] = useState<number>(12);

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

  // The trend is fetched separately so changing the range redraws the chart
  // without reloading the totals or flashing the whole page.
  const loadTrend = useCallback((range: number) => {
    api
      .get("/value-ledger/trend", { params: { months: range } })
      .then((res) => setTrend(Array.isArray(res.data?.points) ? res.data.points : []))
      .catch(() => setTrend([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadTrend(months);
  }, [loadTrend, months]);

  const refresh = useCallback(() => {
    load();
    loadTrend(months);
  }, [load, loadTrend, months]);

  const surplus = Number(metrics?.net_position || 0) >= 0;
  // A chart drawn from twelve empty months says nothing; only offer it once the
  // ledger actually has history to show.
  const hasHistory = trend.some((p) => Number(p.revenue) !== 0 || Number(p.expenses) !== 0);

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
            <Button variant="secondary" size="sm" onClick={refresh} disabled={loading}>
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
                <Button variant="secondary" size="sm" onClick={refresh}>
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
              <section className="mt-8 bg-white rounded-lg border border-gray-200 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Monthly trend</h3>
                    <span className="text-xs text-gray-500">Posted entries, last {months} months</span>
                  </div>
                  <div className="flex gap-1" role="group" aria-label="Trend range">
                    {RANGES.map((range) => (
                      <button
                        key={range}
                        type="button"
                        onClick={() => setMonths(range)}
                        aria-pressed={months === range}
                        className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                          months === range
                            ? "bg-gray-900 text-white border-gray-900"
                            : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        {range}m
                      </button>
                    ))}
                  </div>
                </div>
                {hasHistory ? (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="period" tickFormatter={monthLabel} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} stroke="#94a3b8" width={48} />
                        <Tooltip
                          formatter={(value: number, name: string) => [money(value), name]}
                          labelFormatter={(label: string) => monthLabel(label)}
                        />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#2563eb" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="expenses" name="Expenses" stroke="#d97706" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="net" name="Net" stroke="#15803d" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 py-8 text-center">
                    No ledger history yet. The trend appears once entries are posted for a month — a
                    chart drawn from empty months would say nothing.
                  </p>
                )}
              </section>

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
