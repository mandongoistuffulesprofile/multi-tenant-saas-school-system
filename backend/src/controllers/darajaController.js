/**
 * Controller: Processes Daraja C2B/STK callbacks with receipt deduplication & ledger reconciliation
 */
exports.handleDarajaCallback = async (req, res, dbPool) => {
  // Safaricom requires a 200 response within 3-5 seconds to prevent retries
  res.status(200).json({
    ResultCode: 0,
    ResultDesc: 'Accepted'
  });

  const client = await dbPool.connect();

  try {
    const payload = req.body;
    const body = payload?.Body?.stkCallback || payload;

    const resultCode = body.ResultCode;
    if (resultCode !== 0 && resultCode !== '0') {
      console.warn(`[Daraja] Payment unsuccessful or canceled by user. ResultCode: ${resultCode}`);
      return;
    }

    // Extract Safaricom parameters
    let receiptNumber = null;
    let amount = 0;
    let phoneNumber = null;

    if (body.CallbackMetadata?.Item) {
      for (const item of body.CallbackMetadata.Item) {
        if (item.Name === 'MpesaReceiptNumber') receiptNumber = item.Value;
        if (item.Name === 'Amount') amount = Number(item.Value);
        if (item.Name === 'PhoneNumber') phoneNumber = String(item.Value);
      }
    } else {
      // Direct C2B JSON payload fallback
      receiptNumber = body.TransID;
      amount = Number(body.TransAmount);
      phoneNumber = body.MSISDN;
    }

    const accountRef = body.BillRefNumber || body.AccountReference || 'UNKNOWN';
    const tenantId = req.headers['x-tenant-id'] || body.tenant_id;

    if (!receiptNumber || !amount || !tenantId) {
      console.error('[Daraja] Incomplete webhook payload:', body);
      return;
    }

    // Execute atomic transaction: record payment and credit student ledger
    await client.query('BEGIN');

    // 1. Idempotency Check: Verify if receipt already processed
    const existing = await client.query(
      'SELECT id FROM fee_payments WHERE mpesa_receipt_number = $1 FOR UPDATE',
      [receiptNumber]
    );

    if (existing.rows.length > 0) {
      console.log(`[Daraja] Duplicate callback suppressed for receipt: ${receiptNumber}`);
      await client.query('ROLLBACK');
      return;
    }

    // 2. Identify student by admission number (accountRef)
    const studentRes = await client.query(
      'SELECT id FROM students WHERE tenant_id = $1 AND admission_number = $2 LIMIT 1',
      [tenantId, accountRef]
    );

    const studentId = studentRes.rows[0]?.id || null;

    // 3. Log Payment Record
    await client.query(
      `INSERT INTO fee_payments 
       (tenant_id, student_id, mpesa_receipt_number, phone_number, amount, account_reference, transaction_date, raw_payload)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)`,
      [tenantId, studentId, receiptNumber, phoneNumber, amount, accountRef, JSON.stringify(payload)]
    );

    // 4. Update Student Fee Ledger (if valid student found)
    if (studentId) {
      await client.query(
        `INSERT INTO fee_balances (tenant_id, student_id, total_paid)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, student_id)
         DO UPDATE SET total_paid = fee_balances.total_paid + EXCLUDED.total_paid`,
        [tenantId, studentId, amount]
      );
    }

    await client.query('COMMIT');
    console.log(`[Daraja] Successfully reconciled payment: ${receiptNumber} (KES ${amount}) for Adm: ${accountRef}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Daraja] Error reconciling webhook transaction:', error);
  } finally {
    client.release();
  }
};
