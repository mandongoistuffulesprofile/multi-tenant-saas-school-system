import React, { useState, useEffect, useCallback } from 'react';
import { saveAssessmentOffline, getPendingAssessments, markAssessmentsSynced } from '../services/assessmentDb';

const CBC_LEVELS = [
  { code: 'EE', label: 'Exceeding Expectations', score: 4, color: '#16a34a' },
  { code: 'ME', label: 'Meeting Expectations', score: 3, color: '#2563eb' },
  { code: 'AE', label: 'Approaching Expectations', score: 2, color: '#d97706' },
  { code: 'BE', label: 'Below Expectations', score: 1, color: '#dc2626' }
];

export default function CBCRubricAssessment({ tenantId, subStrand, learners = [] }) {
  const [assessments, setAssessments] = useState({});
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const refreshPendingCount = useCallback(async () => {
    try {
      const pending = await getPendingAssessments(tenantId);
      setPendingCount(pending.length);
    } catch (err) {
      console.error('Error fetching pending counts:', err);
    }
  }, [tenantId]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    refreshPendingCount();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [refreshPendingCount]);

  const handleScoreChange = async (studentId, level) => {
    const entry = {
      tenantId,
      studentId,
      subStrandId: subStrand?.id || 'default_substrand',
      score: level.score,
      ratingCode: level.code
    };

    setAssessments((prev) => ({
      ...prev,
      [studentId]: level.code
    }));

    await saveAssessmentOffline(entry);
    await refreshPendingCount();

    if (navigator.onLine) {
      triggerSync();
    }
  };

  const triggerSync = async () => {
    if (syncing || !navigator.onLine) return;
    setSyncing(true);

    try {
      const pending = await getPendingAssessments(tenantId);
      if (pending.length === 0) {
        setSyncing(false);
        return;
      }

      const res = await fetch('/api/v1/assessments/cbc/bulk-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenantId
        },
        body: JSON.stringify({ assessments: pending })
      });

      if (res.ok) {
        await markAssessmentsSynced(pending.map((p) => p.id));
        await refreshPendingCount();
      }
    } catch (err) {
      console.warn('Sync delayed, data safely stored in IndexedDB:', err);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: '16px', fontFamily: 'sans-serif' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2>CBC 4-Level Assessment Screen</h2>
          <p style={{ color: '#4b5563', margin: 0 }}>
            Sub-Strand: <strong>{subStrand?.name || 'General Competency'}</strong>
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{
            display: 'inline-block',
            padding: '4px 10px',
            borderRadius: '999px',
            fontSize: '12px',
            fontWeight: 600,
            background: isOnline ? '#dcfce7' : '#fee2e2',
            color: isOnline ? '#15803d' : '#b91c1c'
          }}>
            {isOnline ? 'Online' : 'Offline Mode'}
          </span>
          <div style={{ fontSize: '13px', marginTop: '6px' }}>
            {pendingCount > 0 ? (
              <button 
                onClick={triggerSync} 
                disabled={syncing || !isOnline}
                style={{ cursor: isOnline ? 'pointer' : 'not-allowed', padding: '4px 8px' }}
              >
                {syncing ? 'Syncing...' : `Sync ${pendingCount} Local Changes`}
              </button>
            ) : (
              <span style={{ color: '#16a34a' }}>All changes saved</span>
            )}
          </div>
        </div>
      </header>

      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #e5e7eb' }}>
        <thead>
          <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
            <th style={{ padding: '12px', borderBottom: '1px solid #e5e7eb' }}>Admission / Student</th>
            {CBC_LEVELS.map((lvl) => (
              <th key={lvl.code} style={{ padding: '12px', borderBottom: '1px solid #e5e7eb', textAlign: 'center' }}>
                {lvl.code}
                <div style={{ fontSize: '11px', fontWeight: 'normal', color: '#6b7280' }}>({lvl.score})</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {learners.map((learner) => {
            const currentSelected = assessments[learner.id] || learner.initialScoreCode;
            return (
              <tr key={learner.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '12px' }}>
                  <strong>{learner.name}</strong>
                  <div style={{ fontSize: '12px', color: '#6b7280' }}>Adm: {learner.admissionNumber}</div>
                </td>
                {CBC_LEVELS.map((lvl) => {
                  const isChecked = currentSelected === lvl.code;
                  return (
                    <td key={lvl.code} style={{ textAlign: 'center', padding: '12px' }}>
                      <button
                        type="button"
                        onClick={() => handleScoreChange(learner.id, lvl)}
                        style={{
                          width: '42px',
                          height: '42px',
                          borderRadius: '8px',
                          border: isChecked ? `2px solid ${lvl.color}` : '1px solid #d1d5db',
                          background: isChecked ? lvl.color : '#fff',
                          color: isChecked ? '#fff' : '#374151',
                          fontWeight: 'bold',
                          cursor: 'pointer'
                        }}
                      >
                        {lvl.code}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
