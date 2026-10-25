package sms

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

type SMSService struct {
	username string
	apiKey   string
	senderID string
	client   *http.Client
}

func NewSMSService() *SMSService {
	username := os.Getenv("AT_USERNAME")
	apiKey := os.Getenv("AT_API_KEY")
	senderID := os.Getenv("AT_SENDER_ID") // Optional Alphanumeric sender ID

	return &SMSService{
		username: username,
		apiKey:   apiKey,
		senderID: senderID,
		client:   &http.Client{Timeout: 10 * time.Second},
	}
}

// FormatKenyanPhone formats raw phone numbers to standard E.164 (+2547XXXXXXXX)
func FormatKenyanPhone(phone string) string {
	clean := strings.TrimSpace(phone)
	clean = strings.ReplaceAll(clean, " ", "")
	clean = strings.ReplaceAll(clean, "-", "")

	if strings.HasPrefix(clean, "0") && len(clean) == 10 {
		return "+254" + clean[1:]
	}
	if strings.HasPrefix(clean, "254") && len(clean) == 12 {
		return "+" + clean
	}
	if strings.HasPrefix(clean, "+254") && len(clean) == 13 {
		return clean
	}
	return clean
}

// SendSMS dispatches SMS asynchronously via Africa's Talking API
func (s *SMSService) SendSMS(ctx context.Context, to, message string) error {
	if s.username == "" || s.apiKey == "" {
		log.Printf("[SMS MOCK] To: %s | Message: %s", to, message)
		return nil
	}

	endpoint := "https://api.africastalking.com/version1/messaging"
	if strings.ToLower(s.username) == "sandbox" {
		endpoint = "https://api.sandbox.africastalking.com/version1/messaging"
	}

	data := url.Values{}
	data.Set("username", s.username)
	data.Set("to", FormatKenyanPhone(to))
	data.Set("message", message)
	if s.senderID != "" {
		data.Set("from", s.senderID)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(data.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("apiKey", s.apiKey)
	req.Header.Set("Accept", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("sms dispatch network error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("sms gateway returned %d: %s", resp.StatusCode, string(b))
	}

	return nil
}

// SendFeeReceiptAsync dispatches fee payment receipt without blocking HTTP thread
func (s *SMSService) SendFeeReceiptAsync(phone, studentName, admNo, amountKES, balanceKES, schoolName string) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		msg := fmt.Sprintf(
			"Dear Parent, KES %s received for %s (%s). Outstanding Term Balance: KES %s. Thank you for choosing %s.",
			amountKES, studentName, admNo, balanceKES, schoolName,
		)
		if err := s.SendSMS(ctx, phone, msg); err != nil {
			log.Printf("[SMS ERROR] Failed sending receipt to %s: %v", phone, err)
		}
	}()
}
