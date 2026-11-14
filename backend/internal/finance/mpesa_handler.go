package finance

import (
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

type C2BCallbackPayload struct {
	TransactionType     string `json:"TransactionType"`
	TransID             string `json:"TransID"`
	TransTime           string `json:"TransTime"`
	TransAmount         string `json:"TransAmount"`
	BusinessShortCode   string `json:"BusinessShortCode"`
	BillRefNumber       string `json:"BillRefNumber"`
	MSISDN              string `json:"MSISDN"`
	FirstName           string `json:"FirstName"`
	MiddleName          string `json:"MiddleName"`
	LastName            string `json:"LastName"`
	InvoiceNumber       string `json:"InvoiceNumber"`
	ThirdPartyTransID   string `json:"ThirdPartyTransID"`
}

type STKCallbackPayload struct {
	Body struct {
		StkCallback struct {
			MerchantRequestID   string `json:"MerchantRequestID"`
			CheckoutRequestID   string `json:"CheckoutRequestID"`
			ResultCode          int    `json:"ResultCode"`
			ResultDesc          string `json:"ResultDesc"`
			CallbackMetadata    struct {
				Item []struct {
					Name  string      `json:"Name"`
					Value interface{} `json:"Value"`
				} `json:"Item"`
			} `json:"CallbackMetadata"`
		} `json:"stkCallback"`
	} `json:"Body"`
}

type MpesaHandler struct {
	db          *sql.DB
	secretToken string
}

func NewMpesaHandler(db *sql.DB) *MpesaHandler {
	return &MpesaHandler{
		db:          db,
		secretToken: os.Getenv("MPESA_WEBHOOK_SECRET"),
	}
}

// HandleC2BConfirmation handles Safaricom C2B confirmation callbacks.
// Returns 200 OK immediately after persisting to inbox (sub-15ms target).
func (h *MpesaHandler) HandleC2BConfirmation(c *gin.Context) {
	// 1. Verify constant-time Webhook Auth Token
	authToken := c.GetHeader("X-MPESA-Signature-Token")
	if subtle.ConstantTimeCompare([]byte(authToken), []byte(h.secretToken)) != 1 {
		c.JSON(http.StatusUnauthorized, gin.H{"ResultCode": 1, "ResultDesc": "Invalid Signature"})
		return
	}

	var payload C2BCallbackPayload
	rawBody, err := c.GetRawData()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ResultCode": 1, "ResultDesc": "Invalid Payload"})
		return
	}

	if err := json.Unmarshal(rawBody, &payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ResultCode": 1, "ResultDesc": "Malformed JSON"})
		return
	}

	tenantID := c.Param("tenant_id")
	if tenantID == "" {
		tenantID = c.GetString("tenant_id")
	}

	if tenantID == "" {
		// Resolve tenant from the M-Pesa business short code so callbacks are
		// always tenant-scoped. Never fall back to an "unknown" tenant.
		var found string
		err := h.db.QueryRowContext(
			c.Request.Context(),
			`SELECT tenant_id FROM school_payment_channels
			 WHERE shortcode_or_account = $1 AND status = 'ACTIVE'
			 LIMIT 1`,
			payload.BusinessShortCode,
		).Scan(&found)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"ResultCode": 1, "ResultDesc": "Tenant not configured for shortcode"})
			return
		}
		tenantID = found
	}

	// 2. Persist to Inbox with ON CONFLICT DO NOTHING (Pure Idempotence)
	query := `
		INSERT INTO mpesa_inbox (
			tenant_id, trans_id, trans_time, trans_amount,
			business_short_code, bill_ref_number, msisdn, first_name, raw_payload
		) VALUES ($1, $2, $3, $4::numeric, $5, $6, $7, $8, $9)
		ON CONFLICT (tenant_id, trans_id) DO NOTHING
	`

	_, err = h.db.ExecContext(
		c.Request.Context(),
		query,
		tenantID,
		payload.TransID,
		payload.TransTime,
		payload.TransAmount,
		payload.BusinessShortCode,
		payload.BillRefNumber,
		payload.MSISDN,
		payload.FirstName,
		rawBody,
	)

	if err != nil {
		// Log system failure but ack Safaricom if it is a duplicate connection glitch
		c.JSON(http.StatusInternalServerError, gin.H{"ResultCode": 1, "ResultDesc": "Internal Persistence Error"})
		return
	}

	// 3. Immediate Safaricom Confirmation Ack
	c.JSON(http.StatusOK, gin.H{
		"ResultCode": 0,
		"ResultDesc": "Accepted",
	})
}

// HandleSTKCallback handles Safaricom STK Push callbacks.
func (h *MpesaHandler) HandleSTKCallback(c *gin.Context) {
	// 1. Verify constant-time Webhook Auth Token
	authToken := c.GetHeader("X-MPESA-Signature-Token")
	if subtle.ConstantTimeCompare([]byte(authToken), []byte(h.secretToken)) != 1 {
		c.JSON(http.StatusUnauthorized, gin.H{"ResultCode": 1, "ResultDesc": "Invalid Signature"})
		return
	}

	var payload STKCallbackPayload
	rawBody, err := c.GetRawData()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ResultCode": 1, "ResultDesc": "Invalid Payload"})
		return
	}

	if err := json.Unmarshal(rawBody, &payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ResultCode": 1, "ResultDesc": "Malformed JSON"})
		return
	}

	// Extract relevant fields from STK callback
	checkoutRequestID := payload.Body.StkCallback.CheckoutRequestID
	resultCode := payload.Body.StkCallback.ResultCode

	// Find the tenant from the STK request
	var tenantID string
	err = h.db.QueryRowContext(c.Request.Context(),
		`SELECT tenant_id FROM mpesa_stk_requests WHERE checkout_request_id = $1`,
		checkoutRequestID).Scan(&tenantID)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusBadRequest, gin.H{"ResultCode": 1, "ResultDesc": "Unknown STK request"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ResultCode": 1, "ResultDesc": "Internal Error"})
		return
	}

	// Persist STK callback to inbox for unified processing
	// Only persist successful payments (ResultCode == 0)
	if resultCode == 0 {
		var transID, transAmount, msisdn string
		for _, item := range payload.Body.StkCallback.CallbackMetadata.Item {
			switch item.Name {
			case "MpesaReceiptNumber":
				if v, ok := item.Value.(string); ok {
					transID = v
				}
			case "Amount":
				if v, ok := item.Value.(string); ok {
					transAmount = v
				}
			case "PhoneNumber":
				if v, ok := item.Value.(string); ok {
					msisdn = v
				}
			}
		}

		query := `
			INSERT INTO mpesa_inbox (
				tenant_id, trans_id, trans_time, trans_amount,
				business_short_code, bill_ref_number, msisdn, first_name, raw_payload
			) VALUES ($1, $2, NOW()::text, $3::numeric, $4, $5, $6, $7, $8)
			ON CONFLICT (tenant_id, trans_id) DO NOTHING
		`

		_, err = h.db.ExecContext(
			c.Request.Context(),
			query,
			tenantID,
			transID,
			transAmount,
			"STK", // business_short_code
			checkoutRequestID, // bill_ref_number as reference
			msisdn,
			"",
			rawBody,
		)

		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ResultCode": 1, "ResultDesc": "Internal Persistence Error"})
			return
		}

		// Update STK request status with transID
		_, _ = h.db.ExecContext(c.Request.Context(),
			`UPDATE mpesa_stk_requests SET status = $1, callback_received_at = NOW(), callback_payload = $2, mpesa_trans_id = $3 WHERE checkout_request_id = $4 AND tenant_id = $5`,
			"COMPLETED",
			rawBody,
			transID,
			checkoutRequestID,
			tenantID,
		)
	} else {
		// Update STK request status for failed payments
		_, _ = h.db.ExecContext(c.Request.Context(),
			`UPDATE mpesa_stk_requests SET status = $1, callback_received_at = NOW(), callback_payload = $2 WHERE checkout_request_id = $3 AND tenant_id = $4`,
			"FAILED",
			rawBody,
			checkoutRequestID,
			tenantID,
		)
	}

	// 2. Immediate Safaricom Confirmation Ack
	c.JSON(http.StatusOK, gin.H{
		"ResultCode": 0,
		"ResultDesc": "Accepted",
	})
}