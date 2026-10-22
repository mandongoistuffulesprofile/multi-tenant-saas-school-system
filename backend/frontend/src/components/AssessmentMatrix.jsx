import React, { useState, useEffect } from 'react';
import { queueEvaluationOffline } from '../services/offlineDb';
import { SyncManager } from '../services/syncManager';

const RATINGS = [
  { code: 'EE', label: 'Exceeding Expectations', color: 'bg-emerald-600' },
  { code: 'ME', label: 'Meeting Expectations', color: 'bg-blue-600' },
  { code: 'AE', label: 'Approaching Expectations', color: 'bg-amber-600' },
  { code: 'BE', label: 'Below Expectations', color: 'bg-rose-600' },
];

export default function AssessmentMatrix({ students, strand, tenantID }) {
  const [evaluations, setEvaluations] = useState({});
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    SyncManager.init(tenantID);
    const updateStatus = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    return () => {
      window.removeEventListener('online', updateStatus);
      window.removeEventListener('offline', updateStatus);
    };
  }, [tenantID]);

  const handleSelectRating = async (studentId, ratingCode) => {
    setEvaluations((prev) => ({ ...prev, [studentId]: ratingCode }));

    const record = {
      student_id: studentId,
      strand_id: strand.id,
      rating: ratingCode,
      comments: 'Recorded via Teacher Touch PWA',
    };

    if (navigator.onLine) {
      try {
        await fetch('/api/v1/tenant/cbc/evaluations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenantID },
          body: JSON.stringify({ evaluations: [record] }),
        });
      } catch {
        await queueEvaluationOffline(record);
      }
    } else {
      await queueEvaluationOffline(record);
    }
  };

  return (
    <div className="p-4 max-w-4xl mx-auto font-sans">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-bold">CBC Formative Rubric Matrix</h2>
          <p className="text-sm text-gray-500">Strand: {strand?.title || 'Active Learning Area'}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-semibold text-white ${isOnline ? 'bg-green-600' : 'bg-orange-500'}`}>
          {isOnline ? 'Online / Mtandaoni' : 'Offline Mode (Auto-Syncing)'}
        </span>
      </div>

      <div className="space-y-4">
        {students?.map((student) => (
          <div key={student.id} className="p-4 border rounded-xl shadow-sm bg-white flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <p className="font-semibold">{student.first_name} {student.last_name}</p>
              <p className="text-xs text-gray-400">Adm: {student.admission_number} | UPI: {student.upi_nemis || 'N/A'}</p>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {RATINGS.map((r) => {
                const isSelected = evaluations[student.id] === r.code;
                return (
                  <button
                    key={r.code}
                    onClick={() => handleSelectRating(student.id, r.code)}
                    className={`py-2 px-3 text-sm font-bold rounded-lg border transition ${
                      isSelected ? `${r.color} text-white` : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {r.code}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
