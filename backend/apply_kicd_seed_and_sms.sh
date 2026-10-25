#!/usr/bin/env bash
set -e

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"
echo "📂 Working from: $(pwd)"

echo "🧹 [1/5] Cleaning up root binaries and temporary scripts..."
rm -f ./main
rm -f apply_mpesa_and_modules.sh
rm -f fix_and_push.sh

echo "🛡️ [2/5] Hardening .gitignore..."
cat << 'GIT_EOF' > .gitignore
# Binaries & Compiled Output
main
school-api
*.exe
*.exe~
*.dll
*.so
*.dylib
dist/
build/

# Node & Package Managers
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment & Secrets
.env
.env.local
*.pem
*.key

# Temporary files
*.sh
!infrastructure/docker/*.sh
.DS_Store
Thumbs.db
GIT_EOF

echo "📚 [3/5] Creating Official KICD CBC Curriculum Seed..."
mkdir -p migrations/slice3

cat << 'SQL_EOF' > migrations/slice3/005_kicd_curriculum_seed.sql
-- migrations/slice3/005_kicd_curriculum_seed.sql
-- Default KICD Learning Areas and Strands for Kenyan CBC

-- Function to seed default KICD curricula for a tenant
CREATE OR REPLACE FUNCTION seed_default_kicd_curriculum(p_tenant_id UUID)
RETURNS VOID AS $$
DECLARE
    v_math_id UUID;
    v_eng_id UUID;
    v_swa_id UUID;
    v_sci_id UUID;
BEGIN
    -- 1. MATHEMATICS ACTIVITIES (Lower Primary: Grade 1-3)
    INSERT INTO cbc_learning_areas (tenant_id, name, code, grade_level)
    VALUES (p_tenant_id, 'Mathematics Activities', 'MATH_LP', 'Grade 1-3')
    RETURNING id INTO v_math_id;

    INSERT INTO cbc_strands (tenant_id, learning_area_id, title) VALUES
        (p_tenant_id, v_math_id, '1.0 Numbers (Number Concept, Whole Numbers, Addition, Subtraction)'),
        (p_tenant_id, v_math_id, '2.0 Measurement (Length, Mass, Capacity, Time, Money)'),
        (p_tenant_id, v_math_id, '3.0 Geometry (Lines, Shapes)');

    -- 2. ENGLISH LANGUAGE ACTIVITIES
    INSERT INTO cbc_learning_areas (tenant_id, name, code, grade_level)
    VALUES (p_tenant_id, 'English Language Activities', 'ENG_LP', 'Grade 1-3')
    RETURNING id INTO v_eng_id;

    INSERT INTO cbc_strands (tenant_id, learning_area_id, title) VALUES
        (p_tenant_id, v_eng_id, '1.0 Listening and Speaking'),
        (p_tenant_id, v_eng_id, '2.0 Reading (Phonics, Fluency, Comprehension)'),
        (p_tenant_id, v_eng_id, '3.0 Writing (Handwriting, Sentence Formation)');

    -- 3. KISWAHILI SHUGHULI ZA LUGHA
    INSERT INTO cbc_learning_areas (tenant_id, name, code, grade_level)
    VALUES (p_tenant_id, 'Kiswahili Shughuli za Lugha', 'SWA_LP', 'Grade 1-3')
    RETURNING id INTO v_swa_id;

    INSERT INTO cbc_strands (tenant_id, learning_area_id, title) VALUES
        (p_tenant_id, v_swa_id, '1.0 Kusikiliza na Kuzungumza'),
        (p_tenant_id, v_swa_id, '2.0 Kusoma (Kutambua Sauti, Kusoma kwa Ufahamu)'),
        (p_tenant_id, v_swa_id, '3.0 Kuandika (Hati Safi na Tungo Fupi)');

    -- 4. SCIENCE & TECHNOLOGY (Upper Primary: Grade 4-6)
    INSERT INTO cbc_learning_areas (tenant_id, name, code, grade_level)
    VALUES (p_tenant_id, 'Science and Technology', 'SCI_UP', 'Grade 4-6')
    RETURNING id INTO v_sci_id;

    INSERT INTO cbc_strands (tenant_id, learning_area_id, title) VALUES
        (p_tenant_id, v_sci_id, '1.0 Living Things (Plants, Animals, Human Body)'),
        (p_tenant_id, v_sci_id, '2.0 Environment and Cleanliness'),
        (p_tenant_id, v_sci_id, '3.0 Digital Technology and Coding Basics');

END;
$$ LANGUAGE plpgsql;
SQL_EOF

echo "📱 [4/5] Creating Africa's Talking / Kenyan SMS Notification Service..."
mkdir -p backend/internal/notification

cat << 'GO_EOF' > backend/internal/notification/sms.go
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
GO_EOF

echo "🚀 [5/5] Committing and Pushing KICD Seed & SMS Service to GitHub..."
git add .
git commit -m "feat(kicd-sms): add KICD curriculum seed migration, SMS alert service, and clean root binaries"
git push origin main || git push origin master

rm -f apply_kicd_seed_and_sms.sh
echo "✅ KICD seed, SMS service, and cleanup successfully pushed to GitHub!"
