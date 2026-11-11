package daraja

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/sms"
)

// parseAmountFromCallback extracts and validates a monetary amount from Safaricom
// callback metadata. The amount may arrive as a JSON number or string. We keep
// it as a validated decimal string to preserve precision for numeric(12,2) storage.
func parseAmountFromCallback(v interface{}) (string, error) {
	switch val := v.(type) {
	case float64:
		if val <= 0 {
			return "", fmt.Errorf("amount must be positive")
		}
		// Use strconv.FormatFloat with 'f' format to avoid scientific notation.
		// Safaricom amounts are whole KES (no cents in STK), but we handle decimals.
		return strconv.FormatFloat(val, 'f', -1, 64), nil
	case string:
		s := strings.TrimSpace(val)
		if s == "" {
			return "", fmt.Errorf("missing amount")
		}
		// Validate it's a valid number
		f, err := strconv.ParseFloat(s, 64)
		if err != nil || f <= 0 {
			return "", fmt.Errorf("invalid amount: %w", err)
		}
		return s, nil
	default:
		// Fallback: stringify and validate
		s := strings.TrimSpace(fmt.Sprintf("%v", val))
		if s == "" {
			return "", fmt.Errorf("missing amount")
		}
		f, err := strconv.ParseFloat(s, 64)
		if err != nil || f <= 0 {
			return "", fmt.Errorf("invalid amount: %w", err)
		}
		return s, nil
	}
}

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

// ProcessSTKCallback processes asynchronous responses from Safaricom STK Push.
// It persists the callback to the durable mpesa_raw_inbox (idempotent on
// tenant+trans_id) so allocation is handled by the existing inbox worker.
func (s *MpesaService) ProcessSTKCallback(ctx context.Context, tenantID uuid.UUID, body []byte, smsSvc *sms.SMSService) error {
	var cb STKCallbackBody
	if err := json.Unmarshal(body, &cb); err != nil {
		return fmt.Errorf("invalid json: %w", err)
	}

	stk := cb.Body.StkCallback
	if stk.ResultCode != 0 {
		// User cancelled or insufficient balance: mark request failed if known.
		if strings.TrimSpace(stk.CheckoutRequestID) != "" {
			tx, err := s.db.BeginTx(ctx, nil)
			if err == nil {
				defer tx.Rollback()
				if _, err := tx.ExecContext(ctx, "SELECT set_config('app.current_tenant_id', $1, true)", tenantID.String()); err == nil {
					_, _ = tx.ExecContext(ctx, `
						UPDATE mpesa_stk_requests
						SET status = CASE WHEN $3 = 1032 THEN 'CANCELLED' ELSE 'FAILED' END,
						    callback_received_at = NOW(), callback_payload = $4, updated_at = NOW()
						WHERE tenant_id = $1 AND checkout_request_id = $2`,
						tenantID.String(), stk.CheckoutRequestID, stk.ResultCode, body)
					_ = tx.Commit()
				}
			}
		}
		return nil
	}

	var mpesaReceipt, phone, amountStr string
	for _, item := range stk.CallbackMetadata.Item {
		switch item.Name {
		case "MpesaReceiptNumber":
			mpesaReceipt = fmt.Sprintf("%v", item.Value)
		case "Amount":
			amt, err := parseAmountFromCallback(item.Value)
			if err != nil {
				return fmt.Errorf("invalid amount in callback: %w", err)
			}
			amountStr = amt
		case "PhoneNumber":
			phone = fmt.Sprintf("%v", item.Value)
		}
	}
	if mpesaReceipt == "" || amountStr == "" {
		return fmt.Errorf("invalid stk callback: missing receipt or amount")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Parameterized tenant context (no string interpolation).
	if _, err := tx.ExecContext(ctx, "SELECT set_config('app.current_tenant_id', $1, true)", tenantID.String()); err != nil {
		return err
	}

	// Resolve account reference (admission number) from STK request if possible.
	accountRef := "STK-PUSH"
	if strings.TrimSpace(stk.CheckoutRequestID) != "" {
		var ref string
		if err := tx.QueryRowContext(ctx, `
			SELECT COALESCE(account_reference, '')
			FROM mpesa_stk_requests
			WHERE tenant_id = $1 AND checkout_request_id = $2
			LIMIT 1`, tenantID.String(), stk.CheckoutRequestID).Scan(&ref); err == nil && strings.TrimSpace(ref) != "" {
			accountRef = strings.TrimSpace(ref)
		}
	}

	// Persist to durable inbox; allocation/receipting handled by inbox worker.
	// ON CONFLICT makes Safaricom retries idempotent.
	_, err = tx.ExecContext(ctx, `
		INSERT INTO mpesa_raw_inbox
			(tenant_id, trans_id, sender_phone, sender_name, amount, account_reference, raw_payload)
		VALUES ($1, $2, $3, $4, $5::numeric, $6, $7)
		ON CONFLICT (tenant_id, trans_id) DO NOTHING`,
		tenantID.String(), mpesaReceipt, phone, "STK", amountStr, accountRef, body)
	if err != nil {
		return err
	}
	// Best-effort: mark STK request completed.
	if strings.TrimSpace(stk.CheckoutRequestID) != "" {
		_, _ = tx.ExecContext(ctx, `
			UPDATE mpesa_stk_requests
			SET status = 'SUCCESS', callback_received_at = NOW(), callback_payload = $3, mpesa_trans_id = $4, updated_at = NOW()
			WHERE tenant_id = $1 AND checkout_request_id = $2`,
			tenantID.String(), stk.CheckoutRequestID, body, mpesaReceipt)
	}
	if err := tx.Commit(); err != nil {
		return err
	}

	// Best-effort notification; do not fail the callback after durable persist.
	if smsSvc != nil {
		smsSvc.SendFeeReceiptAsync(phone, "Student", mpesaReceipt, amountStr, "Updated in portal", "School")
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

