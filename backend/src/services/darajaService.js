const https = require('https');

class DarajaService {
  constructor() {
    this.env = process.env.DARAJA_ENVIRONMENT || 'production';
    this.consumerKey = process.env.DARAJA_CONSUMER_KEY || '';
    this.consumerSecret = process.env.DARAJA_CONSUMER_SECRET || '';
    this.shortcode = process.env.DARAJA_BUSINESS_SHORTCODE || '';
    this.passkey = process.env.DARAJA_PASSKEY || '';
    this.callbackUrl = process.env.DARAJA_CALLBACK_URL || '';
    
    this.baseURL = this.env === 'sandbox' 
      ? 'https://sandbox.safaricom.co.ke' 
      : 'https://api.safaricom.co.ke';
  }

  // Generates OAuth token from Safaricom Daraja
  async getOAuthToken() {
    return new Promise((resolve, reject) => {
      const auth = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
      const url = `${this.baseURL}/oauth/v1/generate?grant_type=client_credentials`;

      const req = https.get(url, { headers: { Authorization: `Basic ${auth}` } }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.access_token) {
              resolve(parsed.access_token);
            } else {
              reject(new Error(`Daraja Auth Failed: ${data}`));
            }
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
    });
  }

  // Triggers Lipa Na M-Pesa Online STK Push to parent phone
  async initiateSTKPush({ phoneNumber, amount, accountReference, tenantId }) {
    const token = await this.getOAuthToken();
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = Buffer.from(`${this.shortcode}${this.passkey}${timestamp}`).toString('base64');

    // Standardize phone format (e.g. 0712345678 -> 254712345678)
    let formattedPhone = phoneNumber.replace(/[^0-9]/g, '');
    if (formattedPhone.startsWith('0')) formattedPhone = `254${formattedPhone.slice(1)}`;
    if (formattedPhone.startsWith('+')) formattedPhone = formattedPhone.slice(1);

    const payload = JSON.stringify({
      BusinessShortCode: this.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: formattedPhone,
      PartyB: this.shortcode,
      PhoneNumber: formattedPhone,
      CallBackURL: `${this.callbackUrl}?tenant_id=${tenantId}`,
      AccountReference: accountReference,
      TransactionDesc: `School Fees Adm:${accountReference}`
    });

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(`${this.baseURL}/mpesa/stkpush/v1/processrequest`);
      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      };

      const req = https.request(options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => (responseData += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(responseData));
          } catch (e) {
            reject(new Error(`Failed to parse Daraja response: ${responseData}`));
          }
        });
      });

      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }
}

module.exports = new DarajaService();
