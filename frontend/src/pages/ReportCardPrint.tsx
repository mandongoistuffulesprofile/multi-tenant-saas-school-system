import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { OfficialDocumentWrapper } from "../components/OfficialDocumentWrapper";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";

export const ReportCardPrint: React.FC = () => {
  const { t } = useTranslation();
  const { card_id } = useParams<{ card_id: string }>();
  const [card, setCard] = useState<any>(null);
  const [school, setSchool] = useState<any>(null);
  const [learner, setLearner] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!card_id) return;
    let alive = true;
    (async () => {
      try {
        const [cRes, sRes] = await Promise.all([
          api.get(`/reports/cards/${card_id}`),
          api.get("/school").catch(() => ({ data: null })),
        ]);
        if (!alive) return;
        const c = cRes.data;
        setCard(c);
        setSchool(sRes.data);
        try {
          const lRes = c?.learner_id
            ? await api.get(`/learners/${c.learner_id}`).catch(() => ({ data: null }))
            : { data: null };
          if (!alive) return;
          setLearner(lRes.data);
        } catch { /* non-fatal */ }
      } catch (e: any) {
        if (alive) setError(e?.response?.data?.message || t("report_card_print.load_failed"));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // The message is captured on failure; reloading on language change would
    // refetch the card for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card_id]);

  if (loading) return <div className="min-h-screen bg-gray-50 p-6">{t("report_card_print.loading")}</div>;
  if (error || !card) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-xl mx-auto bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-heading mb-2">{t("report_card_print.unavailable_title")}</h2>
          <p className="text-sm text-gray-600 mb-4">{error || t("report_card_print.not_found")}</p>
          <Link to="/reports" className="text-kenyan-red underline">{t("report_card_print.back_to_reports")}</Link>
        </div>
      </div>
    );
  }

  const learnerName = learner ? `${learner.first_name || ""} ${learner.last_name || ""}`.trim() : (card.learner_name || card.learner_id);
  const adm = learner?.admission_number || "—";
  const gradeLabels: Record<string, string> = {
    PP1: "PP1", PP2: "PP2",
    G1: "Grade 1", G2: "Grade 2", G3: "Grade 3", G4: "Grade 4",
    G5: "Grade 5", G6: "Grade 6", G7: "Grade 7", G8: "Grade 8", G9: "Grade 9",
  };
  const grade = learner?.grade_label || gradeLabels[card.grade_id] || card.grade_id || "—";
  const stream = learner?.stream_name ? ` ${learner.stream_name}` : "";
  const schoolName = school?.school_name || school?.name || "School";
  const moe = school?.moe_reg_number || school?.nemis_code || "—";
  const address = school?.address || [school?.po_box, school?.county, "Kenya"].filter(Boolean).join(", ") || "—";
  const academicYear = card.academic_year_label || card.academic_year_id || "—";
  const term = card.term_label || card.term_id || "—";
  const published = card.published_at ? new Date(card.published_at).toLocaleString() : "—";
  const pct = card.percentage != null ? Number(card.percentage).toFixed(1) : "—";
  const snapshot = card.snapshot && typeof card.snapshot === "object" ? card.snapshot : {};
  const showAggregate = snapshot.show_aggregate === true;
  const showPosition = snapshot.show_position === true;
  const national: any[] = Array.isArray(snapshot.national) ? snapshot.national : [];
  // These are the grading nomenclatures themselves (8-point, 4-band), not prose.
  const scaleLabel = snapshot.scale === "EIGHT_POINT" ? "8-point (EE1–BE2)" : snapshot.scale === "FOUR_BAND" ? "4-band (EE–BE)" : "";

  return (
    <ErrorBoundary>
      <div className="space-y-4 min-h-screen bg-gray-50 p-4 print:min-h-0 print:bg-white print:p-0">
        <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-200 print:hidden max-w-5xl mx-auto">
          <div>
            <h2 className="text-base font-bold text-slate-900">{t("report_card_print.header_title")}</h2>
            <p className="text-xs text-slate-500">
              {learnerName} · {t("report_card_print.adm_short")}: {adm} · {grade}{stream} · {card.status}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500 hidden sm:inline">{t("report_card_print.official_note")}</span>
            <Link to="/reports" className="px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium hover:bg-slate-50">{t("report_card_print.back")}</Link>
            <button onClick={() => window.print()} className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-medium hover:bg-slate-50">
              {t("report_card_print.print")}
            </button>
            <button
              onClick={async () => {
                try {
                  const res = await api.get(`/reports/cards/${card_id}/pdf`, { responseType: "blob" });
                  const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `report-card-${card.card_number || card_id}.pdf`;
                  link.click();
                  URL.revokeObjectURL(url);
                } catch {
                  alert(t("report_card_print.pdf_failed"));
                }
              }}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg"
            >
              {t("report_card_print.download_pdf")}
            </button>
          </div>
        </div>

        <OfficialDocumentWrapper
          schoolName={schoolName}
          moeRegNumber={moe}
          poBox={address}
          verificationHash={String(card.card_number || card.card_id || "").slice(0, 12)}
          title={t("report_card_print.doc_title")}
        >
          <div className="space-y-4 text-xs leading-relaxed">
            <div className="grid grid-cols-2 gap-4 pb-3 border-b border-slate-300">
              <div>
                <p><strong>{t("report_card_print.learner")}:</strong> {learnerName}</p>
                <p><strong>{t("report_card_print.admission_no")}:</strong> {adm}</p>
                <p><strong>{t("report_card_print.card_no")}:</strong> {card.card_number || "—"}</p>
              </div>
              <div>
                <p><strong>{t("report_card_print.grade_stream")}:</strong> {grade}{stream}</p>
                <p><strong>{t("report_card_print.academic_year")}:</strong> {academicYear}</p>
                <p><strong>{t("report_card_print.term")}:</strong> {term}</p>
                <p><strong>{t("report_card_print.status")}:</strong> {card.status}</p>
              </div>
            </div>

            {card.results?.length > 0 && (
              <div>
                <h4 className="font-bold text-slate-800 uppercase text-[11px] mb-1">
                  {t("report_card_print.learning_area_performance")} {scaleLabel ? `· ${scaleLabel}` : ""}
                </h4>
                <table className="w-full text-left border border-slate-400">
                  <thead className="bg-slate-100 border-b border-slate-400 text-[11px] font-bold">
                    <tr>
                      <th className="p-2 border-r border-slate-400">{t("report_card_print.th_learning_area")}</th>
                      <th className="p-2 border-r border-slate-400">{t("report_card_print.th_strand")}</th>
                      <th className="p-2 border-r border-slate-400">{t("report_card_print.th_score")}</th>
                      <th className="p-2 border-r border-slate-400">{t("report_card_print.th_level")}</th>
                      <th className="p-2 border-r border-slate-400">{t("report_card_print.th_descriptor")}</th>
                      <th className="p-2">{t("report_card_print.th_remark")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-300">
                    {card.results.map((r: any, i: number) => (
                      <tr key={`${r.learning_area_code || i}-${r.assessment_type || i}-${i}`}>
                        <td className="p-2 border-r border-slate-300 font-medium">{r.learning_area_name || r.learning_area_code}</td>
                        <td className="p-2 border-r border-slate-300">
                          {[r.strand, r.assessment_type, r.assessment_window].filter(Boolean).join(" · ") || "—"}
                        </td>
                        <td className="p-2 border-r border-slate-300">
                          {r.max_score ? `${r.raw_score} / ${r.max_score}` : "—"}
                        </td>
                        <td className="p-2 border-r border-slate-300 font-bold">{r.level_code || "—"}</td>
                        <td className="p-2 border-r border-slate-300">{r.descriptor || "—"}</td>
                        <td className="p-2">{r.comment || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <table className="w-full text-left border border-slate-400">
              <thead className="bg-slate-100 border-b border-slate-400 text-[11px] font-bold">
                <tr>
                  <th className="p-2 border-r border-slate-400">{t("report_card_print.indicator")}</th>
                  <th className="p-2">{t("report_card_print.value")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-300">
                {showAggregate ? (
                  <>
                    <tr><td className="p-2 border-r border-slate-300 font-medium">{t("report_card_print.overall_grade")}</td><td className="p-2 font-bold">{card.overall_grade || "—"}</td></tr>
                    <tr><td className="p-2 border-r border-slate-300 font-medium">{t("report_card_print.total_score")}</td><td className="p-2">{card.total_score ?? "—"} / {card.max_score ?? "—"}</td></tr>
                    <tr><td className="p-2 border-r border-slate-300 font-medium">{t("report_card_print.percentage")}</td><td className="p-2">{pct}{pct !== "—" ? "%" : ""}</td></tr>
                  </>
                ) : (
                  <tr>
                    <td colSpan={2} className="p-2 text-slate-600">
                      {t("report_card_print.levels_only")}
                    </td>
                  </tr>
                )}
                {showPosition && (
                  <tr><td className="p-2 border-r border-slate-300 font-medium">{t("report_card_print.position")}</td><td className="p-2">{card.position ?? "—"}</td></tr>
                )}
                <tr><td className="p-2 border-r border-slate-300 font-medium">{t("report_card_print.published")}</td><td className="p-2">{published}</td></tr>
              </tbody>
            </table>

            {(card.comment || card.head_teacher_comment) && (
              <div className="p-3 bg-slate-50 border border-slate-300 rounded space-y-2">
                {card.comment && <p><strong>{t("report_card_print.teacher_comment")}:</strong> {card.comment}</p>}
                {card.head_teacher_comment && <p><strong>{t("report_card_print.head_comment")}:</strong> {card.head_teacher_comment}</p>}
              </div>
            )}

            <div className="pt-6 grid grid-cols-2 gap-8 text-[11px]">
              <div>
                <p>{t("report_card_print.class_teacher_sign")}: _________________________</p>
                <p className="mt-1 text-slate-500">{t("report_card_print.signature_date")}</p>
              </div>
              <div>
                <p>{t("report_card_print.head_teacher_sign")}: _________________________</p>
                <p className="mt-1 text-slate-500">{t("report_card_print.signature_date")}</p>
              </div>
            </div>
          </div>
        </OfficialDocumentWrapper>

        {national.length > 0 && (
          <section
            className="max-w-5xl mx-auto bg-white rounded-xl border-4 border-slate-800 p-6"
            style={{ breakBefore: "page" }}
          >
            <div className="text-center border-b-2 border-slate-800 pb-3 mb-4">
              <h3 className="text-base font-extrabold uppercase tracking-wide text-slate-900">
                {t("report_card_print.national_title")}
              </h3>
              <p className="text-[11px] text-slate-600 mt-1">
                {learnerName} · {t("report_card_print.adm_short")}: {adm} · {grade} · {academicYear}
              </p>
            </div>
            <p className="text-[11px] text-slate-700 mb-3">
              {t("report_card_print.national_intro")}
            </p>
            <table className="w-full text-left border border-slate-500 text-xs">
              <thead className="bg-slate-100 border-b border-slate-500 font-bold">
                <tr>
                  <th className="p-2 border-r border-slate-400">{t("report_card_print.th_assessment")}</th>
                  <th className="p-2 border-r border-slate-400">{t("report_card_print.th_subject")}</th>
                  <th className="p-2 border-r border-slate-400">{t("report_card_print.th_band")}</th>
                  <th className="p-2">{t("report_card_print.th_descriptor")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-300">
                {national.map((n: any, i: number) => (
                  <tr key={`${n.assessment_type}-${n.subject_code || n.subject_name}-${i}`}>
                    <td className="p-2 border-r border-slate-300">{n.assessment_type}{n.assessment_year ? ` ${n.assessment_year}` : ""}</td>
                    <td className="p-2 border-r border-slate-300">{n.subject_name || n.subject_code || t("report_card_print.overall")}</td>
                    <td className="p-2 border-r border-slate-300 font-extrabold">{n.raw_band}</td>
                    <td className="p-2">{n.descriptor || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-6 text-[11px] text-slate-600">
              <p>{t("report_card_print.stamp")}: ______________________________</p>
              <p className="mt-2">{t("report_card_print.verified_note")}</p>
            </div>
          </section>
        )}
      </div>
    </ErrorBoundary>
  );
};

export default ReportCardPrint;
