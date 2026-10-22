import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../lib/authStore";
import { api } from "../lib/api";

export default function ParentPage() {
  const [learners, setLearners] = useState<any[]>([]);
  const [selectedLearner, setSelectedLearner] = useState<string>("");
  const [attendance, setAttendance] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();
  const { userId } = useAuthStore();

  useEffect(() => {
    // GET /me/linked-learners returns the learner IDs this parent/guardian is linked to.
    api.get("/me/linked-learners")
      .then((res) => {
        setLearners(res.data || []);
        if (res.data && res.data.length > 0) {
          setSelectedLearner(res.data[0].learner_id);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedLearner) return;
    Promise.all([
      api.get(`/attendance/marks?learner_id=${selectedLearner}`),
      api.get(`/assessment/results?learner_id=${selectedLearner}`),
    ]).then(([aRes, rRes]) => {
      setAttendance(aRes.data || []);
      setResults(rRes.data || []);
    }).catch(() => {});
  }, [selectedLearner]);

  if (loading) return <div className="p-4">Loading...</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-xl font-bold text-gray-900 mb-6">My Child</h2>

        {learners.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center text-gray-500">
            No linked learners found. Contact your school administrator.
          </div>
        ) : (
          <>
            <div className="mb-6">
              <label className="label">Select Child</label>
              <select
                className="input-field"
                value={selectedLearner}
                onChange={(e) => setSelectedLearner(e.target.value)}
              >
                {learners.map((l) => (
                  <option key={l.learner_id} value={l.learner_id}>
                    {l.first_name} {l.last_name} ({l.admission_number})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                <h3 className="text-sm font-bold text-gray-900 mb-2">Attendance (this term)</h3>
                <p className="text-2xl font-bold text-blue-600">{attendance.length} records</p>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                <h3 className="text-sm font-bold text-gray-900 mb-2">Assessment Results</h3>
                <p className="text-2xl font-bold text-blue-600">{results.length} records</p>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden mb-6">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Class</th>
                    <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {attendance.map((a, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-900">{a.register_date}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{a.class_group_id || "—"}</td>
                      <td className="px-6 py-4 text-sm text-gray-900">{a.status}</td>
                    </tr>
                  ))}
                  {attendance.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-6 py-8 text-center text-gray-500">No attendance records</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Learning Area</th>
                    <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Score</th>
                    <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Grade</th>
                    <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {results.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-900">{r.learning_area_id || "—"}</td>
                      <td className="px-6 py-4 text-sm text-gray-900">{r.raw_score ?? "—"}</td>
                      <td className="px-6 py-4 text-sm text-gray-900">{r.assigned_grade || "—"}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{r.assessment_date || "—"}</td>
                    </tr>
                  ))}
                  {results.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-8 text-center text-gray-500">No assessment results</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}