exports.handleDarajaCallback = async (req, res, dbPool) => {
  // Always return 200 immediately to Safaricom
  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });

  const client = await dbPool.connect();
  try {
    const payload = req.body;
    const body = payload?.Body?.stkCallback || payload;

    if (body.ResultCode !== 0 && body.ResultCode !== '0') {
      console.warn(`[Daraja] Webhook canceled or failed by customer. ResultCode: ${body.ResultCode}`);
      return;
    }

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
      receiptNumber = body.TransID;
      amount = Number(body.TransAmount);
      phoneNumber = body.MSISDN;
    }

    const accountRef = body.BillRefNumber || body.AccountReference || 'ADM-101';
    
    // CRITICAL BUG FIX: Extract tenantId from query string (Safaricom callback format), header, or body
    const tenantId = req.query.tenant_id || req.headers['x-tenant-id'] || body.tenant_id;

    if (!receiptNumber || !amount) {
      console.error('[Daraja] Incomplete payment details received:', body);
      return;
    }

    await client.query('BEGIN');

    // 1. Idempotency Check
    const dupCheck = await client.query(
      'SELECT id FROM fee_payments WHERE mpesa_receipt_number = $1 FOR UPDATE',
      [receiptNumber]
    );

    if (dupCheck.rows.length > 0) {
      console.log(`[Daraja] Duplicate webhook rejected for receipt: ${receiptNumber}`);
      await client.query('ROLLBACK');
      return;
    }

    // 2. Identify student
    let studentId = null;
    if (tenantId) {
      const studentQuery = await client.query(
        'SELECT id FROM students WHERE tenant_id = $1 AND admission_number = $2 LIMIT 1',
        [tenantId, accountRef]
      );
      studentId = studentQuery.rows[0]?.id || null;
    }

    // 3. Record Payment
    await client.query(
      `INSERT INTO fee_payments 
       (tenant_id, student_id, mpesa_receipt_number, phone_number, amount, account_reference, transaction_date, raw_payload)
       VALUES (COALESCE($1, (SELECT id FROM tenants LIMIT 1)), $2, $3, $4, $5, $6, NOW(), $7)`,
      [tenantId, studentId, receiptNumber, phoneNumber, amount, accountRef, JSON.stringify(payload)]
    );

    // 4. Update Ledger
    if (studentId && tenantId) {
      await client.query(
        `INSERT INTO fee_balances (tenant_id, student_id, total_paid)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, student_id)
         DO UPDATE SET total_paid = fee_balances.total_paid + EXCLUDED.total_paid`,
        [tenantId, studentId, amount]
      );
    }

    await client.query('COMMIT');
    console.log(`[Daraja] Payment of KES ${amount} reconciled for receipt ${receiptNumber}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Daraja Error]', err.message);
  } finally {
    client.release();
  }
};
