import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';

export interface KitchenRecipe {
  id: string;
  recipe_name: string;
  meal_type: string;
  servings_per_batch: number;
  is_active: boolean;
  created_at: string;
}

export interface KitchenRequisitionLine {
  id: string;
  requisition_id: string;
  inventory_item_id: string;
  expected_qty: number;
  actual_issued_qty: number;
  variance_qty: number;
  variance_pct: number;
  unit_cost_at_time?: number | null;
  notes?: string | null;
  created_at: string;
}

export interface KitchenRequisition {
  id: string;
  slip_number: string;
  requisition_date: string;
  meal_type: string;
  recipe_id?: string | null;
  boarder_count_fed: number;
  status: string;
  items?: KitchenRequisitionLine[];
  recipe_name?: string | null;
  total_issued_kg?: number;
}

export interface KitchenRequisitionRow {
  requisition: KitchenRequisition;
  lines: KitchenRequisitionLine[];
  recipe_name: string | null;
  total_issued_kg: number;
}

export default function KitchenRequisitionBoard() {
  const [requisitions, setRequisitions] = useState<KitchenRequisitionRow[]>([]);
  const [recipes, setRecipes] = useState<KitchenRecipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<KitchenRequisitionRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const [reqRes, recipeRes] = await Promise.allSettled([
          api.get<KitchenRequisition[]>('/kitchen/requisitions'),
          api.get<KitchenRecipe[]>('/kitchen/recipes'),
        ]);

        if (!alive) return;

        const reqs: KitchenRequisition[] = (reqRes.status === 'fulfilled' && Array.isArray(reqRes.value?.data))
          ? reqRes.value.data
          : [];

        const recipeRows: KitchenRecipe[] = (recipeRes.status === 'fulfilled' && Array.isArray(recipeRes.value?.data))
          ? recipeRes.value.data
          : [];

        setRecipes(recipeRows);

        const rows: KitchenRequisitionRow[] = reqs.map((r) => ({
          requisition: r,
          lines: r.items ?? [],
          recipe_name: r.recipe_name ?? null,
          total_issued_kg: typeof r.total_issued_kg === 'number' ? r.total_issued_kg : r.items?.reduce((s, l) => s + l.actual_issued_qty, 0) ?? 0,
        }));

        setRequisitions(rows);
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

  const openDetail = async (id: string) => {
    if (!id) return;
    setSelectedId(id);
    setDetailLoading(true);

    try {
      const res = await api.get<KitchenRequisitionRow>(`/kitchen/requisitions/${id}`);
      if (res?.data) {
        setDetail({
          requisition: res.data.requisition ?? res.data,
          lines: res.data.lines ?? res.data.requisition?.items ?? [],
          recipe_name: res.data.recipe_name ?? res.data.requisition?.recipe_name ?? null,
          total_issued_kg: typeof res.data.total_issued_kg === 'number'
            ? res.data.total_issued_kg
            : (res.data.requisition?.items ?? []).reduce((s, l) => s + l.actual_issued_qty, 0),
        });
      }
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <h2 className="text-base font-black text-slate-900 tracking-tight">Kitu cha Masimulio: Sauru za Store (Kitchen Requisition Board)</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Orodha ya sauru za store zinazohitajika, zikilinganishwa na vizuri vya recipe.
        </p>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4">
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-9 bg-slate-200 rounded" />
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="text-left py-1.5 pr-2">Namba ya Sauru</th>
                  <th className="text-left py-1.5 pr-2">Tarehe</th>
                  <th className="text-left py-1.5 pr-2">Aina ya chakula</th>
                  <th className="text-left py-1.5 pr-2">Recipe</th>
                  <th className="text-left py-1.5 pr-2">Wageni waliolimiwa</th>
                  <th className="text-right py-1.5 pr-2">Jumla ya kg iliyotolewa</th>
                  <th className="text-left py-1.5 pr-2">Hali</th>
                  <th className="text-left py-1.5 pr-2">Hitimisho</th>
                </tr>
              </thead>
              <tbody>
                {requisitions.length === 0 ? (
                  <tr>
                    <td className="py-2" colSpan={8}>
                      <span className="text-slate-500">Hakuna sauru za store zilizorejestidi.</span>
                    </td>
                  </tr>
                ) : (
                  requisitions.map((row) => (
                    <tr key={row.requisition.id} className="border-b border-slate-100">
                      <td className="py-1.5 pr-2 font-mono text-slate-800">{row.requisition.slip_number}</td>
                      <td className="py-1.5 pr-2 text-slate-700">{row.requisition.requisition_date}</td>
                      <td className="py-1.5 pr-2 text-slate-700">{row.requisition.meal_type}</td>
                      <td className="py-1.5 pr-2 text-slate-700">
                        {row.recipe_name ?? (row.requisition.recipe_id ? '—' : 'bila recipe')}
                      </td>
                      <td className="py-1.5 pr-2 text-slate-700">{row.requisition.boarder_count_fed}</td>
                      <td className="py-1.5 pr-2 text-right font-mono text-slate-900 font-semibold">
                        {Math.round(row.total_issued_kg * 100) / 100} kg
                      </td>
                      <td className="py-1.5 pr-2">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          row.requisition.status === 'RECONCILED'
                            ? 'bg-emerald-50 text-emerald-800'
                            : row.requisition.status === 'PENDING'
                            ? 'bg-amber-50 text-amber-800'
                            : 'bg-slate-100 text-slate-700'
                        }`}>
                          {row.requisition.status}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2">
                        <button
                          type="button"
                          onClick={() => openDetail(row.requisition.id)}
                          className="text-[11px] font-semibold text-brand-700 hover:underline"
                        >
                          Tafuta
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {requisitions.length > 0 && (
            <p className="text-xs text-slate-500 mt-2">
              {requisitions.length} sauru {requisitions.length === 1 ? 'iliyoregistidi' : 'zilizoregistidi'} store.
            </p>
          )}
        </div>
      )}

      {detailLoading && (
        <div className="bg-blue-50 border border-blue-200 p-3 rounded-lg text-xs text-blue-800">
          Inatengeneza maelezo ya sauru...
        </div>
      )}

      {!detailLoading && detail && (
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex justify-between items-start mb-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Sauru {detail.requisition.slip_number}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {detail.requisition.requisition_date} &bull; {detail.requisition.meal_type} &bull;{' '}
                {detail.requisition.boarder_count_fed} waliolimiwa
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDetail(null)}
              className="text-xs text-slate-500 hover:text-slate-800"
            >
              Zima
            </button>
          </div>

          <div className="mt-2 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-600">Jumla ya kg iliyotolewa:</span>
              <span className="font-mono font-semibold text-slate-900">
                {Math.round(detail.total_issued_kg * 100) / 100} kg
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Recipe:</span>
              <span className="text-slate-900">{detail.recipe_name ?? '—'}</span>
            </div>
          </div>

          {detail.lines.length === 0 ? (
            <p className="text-xs text-slate-500 mt-2">Hakuna vipengele vya sauru vilivyorekodi.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-600">
                    <th className="text-left py-1.5 pr-2">Kitu cha store</th>
                    <th className="text-right py-1.5 pr-2">Inayotarajiwa (kg)</th>
                    <th className="text-right py-1.5 pr-2">Imetolewa (kg)</th>
                    <th className="text-right py-1.5 pr-2">Tofauti (kg)</th>
                    <th className="text-right py-1.5 pr-2">Tofauti (%)</th>
                    <th className="text-left py-1.5 pr-2">Kumbukumbu</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((line) => (
                    <tr key={line.id} className="border-b border-slate-100">
                      <td className="py-1.5 pr-2 text-slate-900">{line.inventory_item_id}</td>
                      <td className="py-1.5 pr-2 text-right font-mono text-slate-900">
                        {line.expected_qty.toLocaleString('en-KE', { maximumFractionDigits: 3 })}
                      </td>
                      <td className="py-1.5 pr-2 text-right font-mono text-slate-900">
                        {line.actual_issued_qty.toLocaleString('en-KE', { maximumFractionDigits: 3 })}
                      </td>
                      <td className="py-1.5 pr-2 text-right font-mono text-slate-900">
                        {line.variance_qty.toLocaleString('en-KE', { maximumFractionDigits: 3 })}
                      </td>
                      <td className="py-1.5 pr-2 text-right font-mono text-slate-900">
                        {(line.variance_pct * 100).toFixed(1)}%
                      </td>
                      <td className="py-1.5 pr-2 text-slate-600">{line.notes ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!detailLoading && !detail && selectedId && (
        <div className="bg-rose-50 border border-rose-200 p-3 rounded-lg text-xs text-rose-800">
          Haihitaji maelezo ya sauru hii.
        </div>
      )}
    </div>
  );
}
