package daraja

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/sms"
)

type STKPushRequest struct {
	PhoneNumber string `json:"phone_number"` // 07... or 2547...
	AmountKES   int64  `json:"amount_kes"`
	AdmissionNo string `json:"admission_no"`
}

type STKCallbackBody struct {
	Body struct {
		StkCallback struct {
			MerchantRequestID string `json:"MerchantRequestID"`
			CheckoutRequestID string `json:"CheckoutRequestID"`
			ResultCode        int    `json:"ResultCode"`
			ResultDesc        string `json:"ResultDesc"`
			CallbackMetadata  struct {
				Item []struct {
					Name  string      `json:"Name"`
					Value interface{} `json:"Value,omitempty"`
				} `json:"Item"`
			} `json:"CallbackMetadata"`
		} `json:"stkCallback"`
	} `json:"Body"`
}

// GetOAuthToken requests an OAuth access token from Safaricom Daraja
func GetOAuthToken(consumerKey, consumerSecret string, isSandbox bool) (string, error) {
	baseURL := "https://api.safaricom.co.ke"
	if isSandbox {
		baseURL = "https://sandbox.safaricom.co.ke"
	}
	url := baseURL + "/oauth/v1/generate?grant_type=client_credentials"

	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	authHeader := base64.StdEncoding.EncodeToString([]byte(consumerKey + ":" + consumerSecret))
	req.Header.Set("Authorization", "Basic "+authHeader)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var tokenResp struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   string `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return "", err
	}
	return tokenResp.AccessToken, nil
}

// InitiateSTKPush triggers Lipa Na M-Pesa Online STK Push on parent's handset
func (s *MpesaService) InitiateSTKPush(ctx context.Context, tenantID uuid.UUID, req STKPushRequest) (map[string]interface{}, error) {
	shortcode := os.Getenv("MPESA_SHORTCODE")
	passkey := os.Getenv("MPESA_PASSKEY")
	consumerKey := os.Getenv("MPESA_CONSUMER_KEY")
	consumerSecret := os.Getenv("MPESA_CONSUMER_SECRET")
	callbackURL := os.Getenv("MPESA_STK_CALLBACK_URL")
	isSandbox := os.Getenv("MPESA_ENV") != "production"

	token, err := GetOAuthToken(consumerKey, consumerSecret, isSandbox)
	if err != nil {
		return nil, fmt.Errorf("failed fetching daraja token: %w", err)
	}

	now := time.Now()
	timestamp := now.Format("20060102150405")
	password := base64.StdEncoding.EncodeToString([]byte(shortcode + passkey + timestamp))
	formattedPhone := strings.TrimPrefix(sms.FormatKenyanPhone(req.PhoneNumber), "+")

	payload := map[string]interface{}{
		"BusinessShortCode": shortcode,
		"Password":          password,
		"Timestamp":         timestamp,
		"TransactionType":   "CustomerPayBillOnline",
		"Amount":            req.AmountKES,
		"PartyA":            formattedPhone,
		"PartyB":            shortcode,
		"PhoneNumber":       formattedPhone,
		"CallBackURL":       fmt.Sprintf("%s?tenant_id=%s", callbackURL, tenantID.String()),
		"AccountReference":  req.AdmissionNo,
		"TransactionDesc":   "School Fee Payment",
	}

	bodyBytes, _ := json.Marshal(payload)
	apiEndpoint := "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest"
	if isSandbox {
		apiEndpoint = "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest"
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, apiEndpoint, bytes.NewBuffer(bodyBytes))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+token)
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("stk push failed: %w", err)
	}
	defer resp.Body.Close()

	var result map[string]interface{}
	_ = json.NewDecoder(resp.Body).Decode(&result)
	return result, nil
}

// ProcessSTKCallback processes asynchronous responses from Safaricom STK Push
func (s *MpesaService) ProcessSTKCallback(ctx context.Context, tenantID uuid.UUID, body []byte, smsSvc *sms.SMSService) error {
	var cb STKCallbackBody
	if err := json.Unmarshal(body, &cb); err != nil {
		return fmt.Errorf("invalid json: %w", err)
	}

	stk := cb.Body.StkCallback
	if stk.ResultCode != 0 {
		// User cancelled or insufficient balance
		return nil
	}

	var mpesaReceipt, phone string
	var amountFloat float64
	for _, item := range stk.CallbackMetadata.Item {
		switch item.Name {
		case "MpesaReceiptNumber":
			mpesaReceipt = fmt.Sprintf("%v", item.Value)
		case "Amount":
			fmt.Sscanf(fmt.Sprintf("%v", item.Value), "%f", &amountFloat)
		case "PhoneNumber":
			phone = fmt.Sprintf("%v", item.Value)
		}
	}

	amountCents := int64(amountFloat * 100)

	// Save transaction and trigger auto-allocation
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, fmt.Sprintf("SET LOCAL app.current_tenant_id = '%s'", tenantID.String())); err != nil {
		return err
	}

	var mpesaID uuid.UUID
	insertQuery := `
		INSERT INTO mpesa_transactions (tenant_id, trans_id, trans_time, trans_amount_cents, msisdn, bill_ref_number, raw_payload)
		VALUES ($1, $2, NOW(), $3, $4, 'STK-PUSH', $5)
		ON CONFLICT (trans_id) DO NOTHING
		RETURNING id;
	`
	err = tx.QueryRowContext(ctx, insertQuery, tenantID, mpesaReceipt, amountCents, phone, body).Scan(&mpesaID)
	if err != nil {
		return nil // Already processed or duplicate
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	// Trigger async SMS receipt
	if smsSvc != nil {
		smsSvc.SendFeeReceiptAsync(phone, "Student", mpesaReceipt, fmt.Sprintf("%.2f", amountFloat), "Updated in portal", "School")
	}

	return nil
}

// RegisterC2BURLs registers Validation and Confirmation URLs with Safaricom
func RegisterC2BURLs(consumerKey, consumerSecret, shortcode, validationURL, confirmationURL string, isSandbox bool) (map[string]interface{}, error) {
	token, err := GetOAuthToken(consumerKey, consumerSecret, isSandbox)
	if err != nil {
		return nil, err
	}

	payload := map[string]string{
		"ShortCode":       shortcode,
		"ResponseType":    "Completed",
		"ConfirmationURL": confirmationURL,
		"ValidationURL":   validationURL,
	}
	body, _ := json.Marshal(payload)

	endpoint := "https://api.safaricom.co.ke/mpesa/c2b/v1/registerurl"
	if isSandbox {
		endpoint = "https://sandbox.safaricom.co.ke/mpesa/c2b/v1/registerurl"
	}

	req, _ := http.NewRequest(http.MethodPost, endpoint, bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result map[string]interface{}
	_ = json.NewDecoder(resp.Body).Decode(&result)
	return result, nil
}
