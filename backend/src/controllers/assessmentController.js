/**
 * Controller: Handles idempotent bulk syncing of CBC rubric scores from offline IndexedDB
 */
exports.bulkSyncAssessments = async (req, res) => {
  const { assessments } = req.body;
  const tenantId = req.tenantId;

  if (!Array.isArray(assessments) || assessments.length === 0) {
    return res.status(400).json({ success: false, message: 'Invalid or empty assessments array.' });
  }

  try {
    let syncedCount = 0;

    for (const item of assessments) {
      const { studentId, subStrandId, score, ratingCode } = item;

      // Upsert: update score if already recorded for this sub-strand, or insert if new
      await req.scopedQuery(
        `INSERT INTO cbc_assessments (tenant_id, student_id, sub_strand_id, score, rating_code, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (tenant_id, student_id, sub_strand_id)
         DO UPDATE SET
           score = EXCLUDED.score,
           rating_code = EXCLUDED.rating_code,
           updated_at = NOW()`,
        [tenantId, studentId, subStrandId, score, ratingCode]
      );
      syncedCount++;
    }

    return res.status(200).json({
      success: true,
      syncedCount,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('CBC Bulk Sync Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to synchronize offline assessments.'
    });
  }
};
