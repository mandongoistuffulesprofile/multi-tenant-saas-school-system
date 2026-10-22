package notification

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// SMSService handles parent alerts via Africa's Talking / Advanta SMS gateways
type SMSService struct {
	apiKey   string
	username string
	senderID string
}

func NewSMSService(apiKey, username, senderID string) *SMSService {
	return &SMSService{
		apiKey:   apiKey,
		username: username,
		senderID: senderID,
	}
}

// SendFeeReceiptSMS notifies guardian when Daraja M-Pesa payment is confirmed
func (s *SMSService) SendFeeReceiptSMS(ctx context.Context, recipientPhone, studentName, amount, receiptNumber string) error {
	message := fmt.Sprintf(
		"Shule Yetu: Tumepokea KES %s kwa jina la %s. Stakabadhi ya M-Pesa: %s. Asante.",
		amount, studentName, receiptNumber,
	)
	return s.dispatchSMS(ctx, recipientPhone, message)
}

// SendAbsenteeismAlert notifies guardian if learner is absent during morning roll call
func (s *SMSService) SendAbsenteeismAlert(ctx context.Context, recipientPhone, studentName, date string) error {
	message := fmt.Sprintf(
		"Shule Yetu: Mwanafunzi %s hakuwepo shuleni asubuhi ya leo tarehe %s. Tafadhali wasiliana na mwalimu mkuu.",
		studentName, date,
	)
	return s.dispatchSMS(ctx, recipientPhone, message)
}

func (s *SMSService) dispatchSMS(ctx context.Context, phone, message string) error {
	if s.apiKey == "" || s.apiKey == "sandbox" {
		// Log in development/sandbox mode without spending real SMS credits
		log.Printf("📢 [SMS DISPATCH SIMULATION] To: %s | Message: %s", phone, message)
		return nil
	}

	endpoint := "https://api.africastalking.com/version1/messaging"
	data := url.Values{}
	data.Set("username", s.username)
	data.Set("to", phone)
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

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("SMS gateway network error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("SMS gateway rejected request with status: %d", resp.StatusCode)
	}

	return nil
}
