package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"strings"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/outbox"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/sms"
)

type outboxDispatcher struct {
	sms *sms.SMSService
}

func (d *outboxDispatcher) Dispatch(ctx context.Context, topic string, payload []byte) error {
	var data map[string]interface{}
	if err := json.Unmarshal(payload, &data); err != nil {
		return nil // Ignore unparseable payloads
	}
	getStr := func(keys ...string) string {
		for _, k := range keys {
			if v, ok := data[k]; ok {
				if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
					return strings.TrimSpace(s)
				}
			}
		}
		return ""
	}
	eventType := strings.ToUpper(strings.TrimSpace(topic))
	channel := strings.ToUpper(getStr("channel", "Channel"))
	phone := getStr("phone", "phone_number", "to", "recipient_phone", "msisdn")
	message := getStr("message", "body", "body_text", "text", "sms_text")
	if (channel == "SMS" || strings.Contains(eventType, "SMS") || strings.Contains(eventType, "RECEIPT") || strings.Contains(eventType, "ALERT") || strings.Contains(eventType, "NOTICE")) && phone != "" && message != "" {
		return d.sms.SendSMS(ctx, phone, message)
	}
	slog.Info("outbox_event_ignored", "event_type", topic, "tenant_id", getStr("tenant_id"))
	return nil
}

func newOutboxWorker(db *sql.DB, smsSvc *sms.SMSService, logger *slog.Logger) *outbox.OutboxWorker {
	return outbox.NewOutboxWorker(db, &outboxDispatcher{sms: smsSvc}, logger)
}