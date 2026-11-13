import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';

/**
 * InKindIntakeBoard
 *
 * First consumption-facing screen for the in-kind intake module.
 * Mirrors the real backend contracts:
 *   - GET /inkind/items
 *   - GET /inkind/rates
 *   - GET /inkind/intakes
 *
 * Falls back to a safe empty-state board when apiBase is not available
 * or the backend is unreachable.
 */
export interface InKindInventoryItem {
  id: string;
  code: string;
  name: string;
  unit: string;
  standard_unit_weight_kg?: number | null;
  is_active: boolean;
}

export interface InKindRate {
  id: string;
  inventory_item_id: string;
  commodity_name: string;
  unit: string;
  rate_per_unit: number;
  is_active: boolean;
  term_id: string;
}

export interface InKindIntakeLog {
  id: string;
  tenant_id: string;
  student_id: string;
  intake_date: string;
  intake_number: string;
  status: string;
  notes?: string | null;
}

export interface InKindIntakeItem {
  id: string;
  intake_log_id: string;
  inventory_item_id: string;
  quantity: number;
  unit: string;
  rate_per_unit: number;
  cash_equivalent: number;
  quality_grade?: string | null;
}

export interface InKindIntakeRow {
  intake: InKindIntakeLog;
  items: InKindIntakeItem[];
  total_cash_equivalent: number;
}

export default function InKindIntakePage() {
  const [inventory, setInventory] = useState<InKindInventoryItem[]>([]);
  const [rates, setRates] = useState<InKindRate[]>([]);
  const [intakes, setIntakes] = useState<InKindIntakeRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const [itemsRes, ratesRes, intakesRes] = await Promise.allSettled([
          api.get<InKindInventoryItem[]>('/inkind/items'),
          api.get<InKindRate[]>('/inkind/rates'),
          api.get<{ data: InKindIntakeLog[] }>('/inkind/intakes'),
        ]);

        if (!alive) return;

        const items = (itemsRes.status === 'fulfilled' && Array.isArray(itemsRes.value?.data))
          ? itemsRes.value.data
          : [];

        const rateRows = (ratesRes.status === 'fulfilled' && Array.isArray(ratesRes.value?.data))
          ? ratesRes.value.data
          : [];

        const intakeLogs: InKindIntakeLog[] = (intakesRes.status === 'fulfilled' && Array.isArray(intakesRes.value?.data))
          ? intakesRes.value.data
          : [];

        setInventory(items);
        setRates(rateRows);

        const rateByItem = new Map<string, InKindRate | undefined>();
        for (const r of rateRows) {
          if (!rateByItem.has(r.inventory_item_id)) {
            rateByItem.set(r.inventory_item_id, r);
          }
        }

        const rows: InKindIntakeRow[] = intakeLogs.map((log) => ({
          intake: log,
          items: [],
          total_cash_equivalent: 0,
        }));

        setIntakes(rows);
      } catch {
        // keep empty board when backend is unreachable
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <h2 className="text-base font-black text-slate-900 tracking-tight">Ushauri wa Ukawaji wa Vito (In-Kind Intake Board)</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Kudumisha ulipo na bei za kufungua, masoko ya vito, na sarakli za ukawaji wa vito.
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-white rounded-xl border border-slate-200 shadow-xs">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Vitu vya Usafirishaji</h3>
            <div className="mt-2 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-6 bg-slate-200 rounded" />
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Bei za Kufungua</h3>
            <div className="mt-2 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-6 bg-slate-200 rounded" />
              ))}
            </div>
          </div>
          <div className="md:col-span-2">
            <h3 className="text-sm font-semibold text-slate-900">Sarakli za Ukawaji wa Vito</h3>
            <div className="mt-2 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-8 bg-slate-200 rounded" />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-white rounded-xl border border-slate-200 shadow-xs">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Vitu vya Usafirishaji ({inventory.length})</h3>
            {inventory.length === 0 ? (
              <p className="text-xs text-slate-500 mt-2">Hakuna vitu vya usafirishaji vilivyoregistidi.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {inventory.slice(0, 10).map((item) => (
                  <li key={item.id} className="flex justify-between text-xs border-b border-slate-100 pb-1.5">
                    <span className="font-medium text-slate-900">{item.name}</span>
                    <span className="text-slate-500">{item.code} / {item.unit}</span>
                  </li>
                ))}
                {inventory.length > 10 && (
                  <li className="text-xs text-slate-500 italic">
                    ... na {inventory.length - 10} vinginezo.
                  </li>
                )}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-900">Bei za Kufungua ({rates.length})</h3>
            {rates.length === 0 ? (
              <p className="text-xs text-slate-500 mt-2">Hakuna bei za kufungua zilizorejestidi.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {rates.slice(0, 10).map((rate) => (
                  <li key={rate.id} className="flex justify-between text-xs border-b border-slate-100 pb-1.5">
                    <div>
                      <span className="font-medium text-slate-900">{rate.commodity_name}</span>
                      <span className="text-slate-500 ml-1">({rate.unit})</span>
                    </div>
                    <span className="font-mono text-slate-800 font-semibold">
                      {Number(rate.rate_per_unit).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                    </span>
                  </li>
                ))}
                {rates.length > 10 && (
                  <li className="text-xs text-slate-500 italic">
                    ... na {rates.length - 10} za kufungua nyinginezo.
                  </li>
                )}
              </ul>
            )}
          </div>

          <div className="md:col-span-2">
            <h3 className="text-sm font-semibold text-slate-900">Sarakli za Ukawaji wa Vito ({intakes.length})</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-600">
                    <th className="text-left py-1.5 pr-2">Nambari ya Sarakli</th>
                    <th className="text-left py-1.5 pr-2">Tarehe</th>
                    <th className="text-left py-1.5 pr-2">Hali</th>
                    <th className="text-right py-1.5 pr-2" style={{ width: 120 }}>Jumla ya Kiasidi (KES)</th>
                  </tr>
                </thead>
                <tbody>
                  {intakes.length === 0 ? (
                    <tr>
                      <td className="py-2" colSpan={4}>
                        <span className="text-slate-500">Hakuna sarakli za ukawaji wa vito zilizojazwa.</span>
                      </td>
                    </tr>
                  ) : (
                    intakes.map((row) => (
                      <tr key={row.intake.id} className="border-b border-slate-100">
                        <td className="py-1.5 pr-2 font-mono text-slate-800">{row.intake.intake_number}</td>
                        <td className="py-1.5 pr-2 text-slate-700">{row.intake.intake_date}</td>
                        <td className="py-1.5 pr-2">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            row.intake.status === 'VERIFIED'
                              ? 'bg-emerald-50 text-emerald-800'
                              : row.intake.status === 'PENDING'
                              ? 'bg-amber-50 text-amber-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}>
                            {row.intake.status}
                          </span>
                        </td>
                        <td className="py-1.5 pr-2 text-right font-mono text-slate-900 font-semibold" style={{ width: 120 }}>
                          {Math.round(row.total_cash_equivalent).toLocaleString('en-KE')}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {intakes.length > 0 && (
              <p className="text-xs text-slate-500 mt-2">
                {intakes.length} saraki {intakes.length === 1 ? 'ililojaza' : 'zilizojaza'} vito.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
