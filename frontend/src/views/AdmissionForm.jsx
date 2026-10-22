import React, { useState } from 'react';

export default function AdmissionForm({ tenantID = 'default' }) {
  const [formData, setFormData] = useState({
    admissionNumber: '',
    upiNemis: '',
    firstName: '',
    lastName: '',
    gender: 'MALE',
    dateOfBirth: '',
    guardianName: '',
    guardianPhone: '',
    guardianRelationship: 'MOTHER',
  });

  const [status, setStatus] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus({ type: 'loading', text: 'Inasajili mwanafunzi...' });

    try {
      const res = await fetch('/api/v1/tenant/students', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenantID,
        },
        body: JSON.stringify({
          admission_number: formData.admissionNumber,
          upi_nemis: formData.upiNemis || null,
          first_name: formData.firstName,
          last_name: formData.lastName,
          gender: formData.gender,
          date_of_birth: formData.dateOfBirth,
        }),
      });

      if (res.ok) {
        setStatus({ type: 'success', text: 'Mwanafunzi amesajiliwa kikamilifu! (Learner admitted successfully)' });
        setFormData({
          admissionNumber: '',
          upiNemis: '',
          firstName: '',
          lastName: '',
          gender: 'MALE',
          dateOfBirth: '',
          guardianName: '',
          guardianPhone: '',
          guardianRelationship: 'MOTHER',
        });
      } else {
        setStatus({ type: 'error', text: 'Kosa: Nambari ya usajili inaweza kuwa tayari ipo.' });
      }
    } catch {
      setStatus({ type: 'error', text: 'Kosa la mawasiliano na seva / Network error' });
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6 max-w-2xl mx-auto">
      <h2 className="text-xl font-bold text-gray-800 mb-1">Usajili wa Mwanafunzi (Student Admission)</h2>
      <p className="text-sm text-gray-500 mb-6">Taarifa za mwanafunzi na mzazi kulingana na muongozo wa NEMIS/CBC.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Nambari ya Usajili (Admission No) *</label>
            <input
              required
              type="text"
              placeholder="mf. ADM-2026-042"
              value={formData.admissionNumber}
              onChange={(e) => setFormData({ ...formData, admissionNumber: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">NEMIS UPI (Hiari / Optional)</label>
            <input
              type="text"
              placeholder="mf. ABC1234567"
              value={formData.upiNemis}
              onChange={(e) => setFormData({ ...formData, upiNemis: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Jina la Kwanza (First Name) *</label>
            <input
              required
              type="text"
              value={formData.firstName}
              onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Jina la Mwisho (Last Name) *</label>
            <input
              required
              type="text"
              value={formData.lastName}
              onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Jinsia (Gender) *</label>
            <select
              value={formData.gender}
              onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="MALE">Mvulana (Male)</option>
              <option value="FEMALE">Msichana (Female)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Tarehe ya Kuzaliwa (DOB) *</label>
            <input
              required
              type="date"
              value={formData.dateOfBirth}
              onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="pt-4 border-t">
          <h3 className="text-sm font-bold text-gray-700 mb-3">Taarifa za Mzazi/Mlezi (Guardian Information)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Jina la Mzazi (Guardian Name)</label>
              <input
                type="text"
                placeholder="mf. Mary Wanjiku"
                value={formData.guardianName}
                onChange={(e) => setFormData({ ...formData, guardianName: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Simu ya M-Pesa (Phone for Alerts)</label>
              <input
                type="tel"
                placeholder="+2547XXXXXXXX"
                value={formData.guardianPhone}
                onChange={(e) => setFormData({ ...formData, guardianPhone: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>

        {status && (
          <div className={`p-3 rounded-lg text-sm ${status.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {status.text}
          </div>
        )}

        <button
          type="submit"
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl transition"
        >
          Sajili Mwanafunzi (Admit Learner)
        </button>
      </form>
    </div>
  );
}
