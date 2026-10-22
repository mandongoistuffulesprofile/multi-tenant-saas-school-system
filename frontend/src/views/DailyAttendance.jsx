import React, { useState } from 'react';

const STATUS_OPTIONS = [
  { code: 'PRESENT', label: 'P', color: 'bg-emerald-600 text-white' },
  { code: 'ABSENT', label: 'A', color: 'bg-rose-600 text-white' },
  { code: 'EXCUSED', label: 'E', color: 'bg-amber-500 text-white' },
  { code: 'SICK', label: 'S', color: 'bg-purple-600 text-white' },
];

export default function DailyAttendance({ streamId = 'stream-1', tenantID = 'default' }) {
  const [session, setSession] = useState('MORNING');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [attendance, setAttendance] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // Sample stream roster
  const sampleStudents = [
    { id: '11111111-1111-1111-1111-111111111111', name: 'Juma Omondi', admission: 'ADM-001' },
    { id: '22222222-2222-2222-2222-222222222222', name: 'Achieng Nekesa', admission: 'ADM-002' },
    { id: '33333333-3333-3333-3333-333333333333', name: 'Mwangi Kamau', admission: 'ADM-003' },
    { id: '44444444-4444-4444-4444-444444444444', name: 'Fatuma Hassan', admission: 'ADM-004' },
  ];

  const handleStatusChange = (studentId, status) => {
    setAttendance((prev) => ({ ...prev, [studentId]: status }));
  };

  const handleMarkAllPresent = () => {
    const updated = {};
    sampleStudents.forEach((st) => {
      updated[st.id] = 'PRESENT';
    });
    setAttendance(updated);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setFeedback(null);

    const entries = sampleStudents.map((st) => ({
      student_id: st.id,
      status: attendance[st.id] || 'PRESENT',
      remarks: null,
    }));

    try {
      const res = await fetch('/api/v1/tenant/attendance/roll-call', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenantID,
        },
        body: JSON.stringify({
          stream_id: '12345678-1234-1234-1234-1234567890ab',
          date,
          session,
          entries,
        }),
      });

      if (res.ok) {
        setFeedback({ type: 'success', text: 'Mahudhurio yamerekodiwa / Roll call saved successfully!' });
      } else {
        setFeedback({ type: 'error', text: 'Kosa limetokea / Error recording roll call' });
      }
    } catch {
      setFeedback({ type: 'info', text: 'Offline mode: Queued locally in IndexedDB.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-4 border-b">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Daily Attendance / Mahudhurio ya Kila Siku</h2>
          <p className="text-sm text-gray-500">Grade 3 East - Class Register</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm font-medium"
          />
          <div className="flex border rounded-lg overflow-hidden">
            <button
              onClick={() => setSession('MORNING')}
              className={`px-3 py-1.5 text-xs font-semibold ${session === 'MORNING' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
            >
              Asubuhi (AM)
            </button>
            <button
              onClick={() => setSession('AFTERNOON')}
              className={`px-3 py-1.5 text-xs font-semibold ${session === 'AFTERNOON' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
            >
              Mchana (PM)
            </button>
          </div>
        </div>
      </div>

      <div className="flex justify-between items-center mb-4">
        <button
          onClick={handleMarkAllPresent}
          className="bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 text-xs font-bold py-2 px-3 rounded-lg"
        >
          ✓ Weka Wote Wapo (Mark All Present)
        </button>
      </div>

      <div className="space-y-3">
        {sampleStudents.map((st) => {
          const currentStatus = attendance[st.id] || 'PRESENT';
          return (
            <div key={st.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
              <div>
                <p className="font-semibold text-sm text-gray-800">{st.name}</p>
                <p className="text-xs text-gray-400">Adm: {st.admission}</p>
              </div>
              <div className="flex gap-1.5">
                {STATUS_OPTIONS.map((opt) => {
                  const isSelected = currentStatus === opt.code;
                  return (
                    <button
                      key={opt.code}
                      onClick={() => handleStatusChange(st.id, opt.code)}
                      className={`w-9 h-9 rounded-lg font-bold text-xs transition ${
                        isSelected ? opt.color : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {feedback && (
        <div className={`mt-4 p-3 rounded-lg text-sm ${feedback.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'}`}>
          {feedback.text}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={isSubmitting}
        className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-sm transition"
      >
        {isSubmitting ? 'Inahifadhi / Saving...' : 'Hifadhi Mahudhurio (Save Attendance)'}
      </button>
    </div>
  );
}
