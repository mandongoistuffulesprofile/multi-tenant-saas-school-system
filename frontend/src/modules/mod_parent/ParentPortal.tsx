import React, { useState, useEffect } from 'react';

export const ParentPortal: React.FC = () => {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch('/api/v1/parent/summary').then((r) => r.json()).then(setData).catch(() => {});
  }, []);

  if (!data) return <div className="p-4">Loading...</div>;

  return (
    <div className="p-4 max-w-md mx-auto">
      <h2 className="text-xl font-bold mb-4">Parent Portal</h2>
      <p>Student: {data.student_name}</p>
      <p>Fee Balance: {data.fee_balance}</p>
      <p>Attendance: {data.attendance_pct}%</p>
    </div>
  );
};
