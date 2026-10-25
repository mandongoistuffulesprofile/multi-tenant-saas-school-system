const darajaService = require('../services/darajaService');

exports.triggerSTKPush = async (req, res) => {
  const { phoneNumber, amount, admissionNumber } = req.body;
  const tenantId = req.tenantId;

  if (!phoneNumber || !amount || !admissionNumber) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: phoneNumber, amount, or admissionNumber.'
    });
  }

  try {
    const result = await darajaService.initiateSTKPush({
      phoneNumber,
      amount: Number(amount),
      accountReference: admissionNumber,
      tenantId
    });

    if (result.ResponseCode === '0') {
      return res.status(200).json({
        success: true,
        message: 'STK push prompt dispatched to parent phone.',
        checkoutRequestID: result.CheckoutRequestID,
        merchantRequestID: result.MerchantRequestID
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.ResponseDescription || 'Safaricom STK Push rejected request.'
      });
    }
  } catch (error) {
    console.error('[Daraja STK Push Error]', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to initiate M-Pesa STK push.'
    });
  }
};
