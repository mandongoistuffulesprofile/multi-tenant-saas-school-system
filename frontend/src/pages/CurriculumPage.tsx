import { useState, useEffect } from "react";
import { api } from "../lib/api";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";

export default function CurriculumPage() {
  const [versions, setVersions] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [expandedArea, setExpandedArea] = useState<string>("");
  const [strands, setStrands] = useState<Record<string, any[]>>({});
  const [expandedStrand, setExpandedStrand] = useState<string>("");
  const [subStrands, setSubStrands] = useState<Record<string, any[]>>({});

  useEffect(() => {
    api.get("/curriculum/versions").then((res) => {
      const list = res.data || [];
      setVersions(list);
      setLoading(false);
      // Pick the version that actually owns learning areas so the page never
      // opens on a misleading empty state (Published CBC 2024 has none).
      api.get("/curriculum/areas").then((aRes) => {
        const all: any[] = Array.isArray(aRes.data) ? aRes.data : [];
        const counts = new Map<string, number>();
        all.forEach((a) => { if (a.version_id) counts.set(a.version_id, (counts.get(a.version_id) || 0) + 1); });
        const withMost = [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
        const firstId = (withMost && list.some((v: any) => v.version_id === withMost[0]))
          ? withMost[0]
          : (list[0]?.version_id ?? "");
        setSelectedVersion(firstId);
        loadAreas(firstId);
      }).catch(() => {
        if (list.length > 0) {
          setSelectedVersion(list[0].version_id);
          loadAreas(list[0].version_id);
        }
      });
    }).catch(() => setLoading(false));
  }, []);

  const loadAreas = (versionId: string) => {
    setExpandedArea("");
    setExpandedStrand("");
    setStrands({});
    setSubStrands({});
    api.get(`/curriculum/areas?version_id=${versionId}`).then((res) => {
      setAreas(res.data || []);
    }).catch(() => setAreas([]));
  };

  const toggleArea = async (area: any) => {
    if (expandedArea === area.area_id) {
      setExpandedArea("");
      return;
    }
    setExpandedArea(area.area_id);
    setExpandedStrand("");
    if (!strands[area.area_id]) {
      try {
        const res = await api.get("/curriculum/strands", { params: { area_id: area.area_id } });
        setStrands((current) => ({ ...current, [area.area_id]: Array.isArray(res.data) ? res.data : [] }));
      } catch {
        setStrands((current) => ({ ...current, [area.area_id]: [] }));
      }
    }
  };

  const toggleStrand = async (strand: any) => {
    if (expandedStrand === strand.strand_id) {
      setExpandedStrand("");
      return;
    }
    setExpandedStrand(strand.strand_id);
    if (!subStrands[strand.strand_id]) {
      try {
        const res = await api.get("/curriculum/sub-strands", { params: { strand_id: strand.strand_id } });
        setSubStrands((current) => ({ ...current, [strand.strand_id]: Array.isArray(res.data) ? res.data : [] }));
      } catch {
        setSubStrands((current) => ({ ...current, [strand.strand_id]: [] }));
      }
    }
  };

  const bandLabel = (band: string) => ({
    EYE: "PP1–PP2",
    LOWER_PRIMARY: "Grade 1–3",
    UPPER_PRIMARY: "Grade 4–6",
    JSS: "Grade 7–9",
  } as Record<string, string>)[band] || band || "—";

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-heading mb-6">Curriculum</h2>
          {loading ? (
            <Skeleton rows={5} columns={4} />
          ) : (
            <>
              <div className="card p-6 mb-6">
                <label className="label">Curriculum Version</label>
                <select
                  className="input-field max-w-xs"
                  value={selectedVersion}
                  onChange={(e) => {
                    setSelectedVersion(e.target.value);
                    loadAreas(e.target.value);
                  }}
                >
                  {versions.map((v) => (
                    <option key={v.version_id} value={v.version_id}>
                      {v.version_label} ({v.is_published ? "Published" : "Draft"})
                    </option>
                  ))}
                </select>
              </div>
              <div className="card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-caption uppercase tracking-wide">KICD Curriculum Tree</h3>
                  <p className="text-xs text-gray-500">
                    Learning areas, strands and sub-strands are pre-loaded. Expand to review before grading.
                  </p>
                </div>
                {areas.length === 0 ? (
                  <p className="text-sm text-gray-500">No learning areas found for this version.</p>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {areas.map((area: any) => (
                      <div key={area.area_id}>
                        <button
                          type="button"
                          onClick={() => toggleArea(area)}
                          className="w-full flex items-center justify-between gap-3 py-2 text-left hover:bg-gray-50 px-2 rounded"
                        >
                          <span className="flex items-center gap-2">
                            <span className="text-xs font-mono text-gray-500 w-16">{area.code}</span>
                            <span className="text-sm font-medium text-gray-900">{area.name}</span>
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                              {bandLabel(area.grade_band)}
                            </span>
                          </span>
                          <span className="text-xs text-gray-400">{expandedArea === area.area_id ? "−" : "+"}</span>
                        </button>
                        {expandedArea === area.area_id && (
                          <div className="pl-20 pb-3">
                            {(strands[area.area_id] || []).length === 0 ? (
                              <p className="text-xs text-gray-500 py-2">No strands captured.</p>
                            ) : (
                              <div className="space-y-1">
                                {(strands[area.area_id] || []).map((strand: any) => (
                                  <div key={strand.strand_id}>
                                    <button
                                      type="button"
                                      onClick={() => toggleStrand(strand)}
                                      className="flex items-center gap-2 text-sm text-gray-800 hover:text-kenyan-red py-1"
                                    >
                                      <span className="text-xs font-mono text-gray-400">{strand.code}</span>
                                      {strand.name}
                                      <span className="text-xs text-gray-400">{expandedStrand === strand.strand_id ? "−" : "+"}</span>
                                    </button>
                                    {expandedStrand === strand.strand_id && (
                                      <ul className="ml-8 mb-2 border-l border-gray-200 pl-3 space-y-1">
                                        {(subStrands[strand.strand_id] || []).length === 0 ? (
                                          <li className="text-xs text-gray-500">No sub-strands captured.</li>
                                        ) : (
                                          (subStrands[strand.strand_id] || []).map((sub: any) => (
                                            <li key={sub.sub_strand_id} className="text-xs text-gray-600">
                                              <span className="font-mono text-gray-400 mr-2">{sub.code}</span>
                                              {sub.name}
                                            </li>
                                          ))
                                        )}
                                      </ul>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}