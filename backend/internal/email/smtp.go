package email

import (
	"fmt"
	"log"
	"net/smtp"
)

// Sender delivers email. When SMTP credentials are not configured it falls
// back to writing the message to stdout so development flows remain usable
// without an external mail provider.
type Sender interface {
	Send(to, subject, body string) error
}

type smtpSender struct {
	host     string
	port     int
	user     string
	pass     string
	from     string
	fromName string
}

func (s *smtpSender) Send(to, subject, body string) error {
	// No credentials configured — dev/log-only mode. The full message is
	// written to stdout so it can be inspected and copied manually.
	if s.user == "" || s.pass == "" {
		log.Printf("[EMAIL MOCK] To: %s | From: %s <%s> | Subject: %s\n---\n%s\n---", to, s.fromName, s.from, subject, body)
		return nil
	}

	from := fmt.Sprintf("%s <%s>", s.fromName, s.from)
	msg := []byte(
		"From: " + from + "\r\n" +
			"To: " + to + "\r\n" +
			"Subject: " + subject + "\r\n" +
			"MIME-version: 1.0;\r\nContent-Type: text/html; charset=\"UTF-8\";\r\n\r\n" +
			body + "\r\n",
	)

	auth := smtp.PlainAuth("", s.user, s.pass, s.host)
	addr := fmt.Sprintf("%s:%d", s.host, s.port)

	conn, err := smtp.Dial(addr)
	if err != nil {
		return fmt.Errorf("smtp dial: %w", err)
	}
	defer conn.Close()

	if err := conn.Hello(s.host); err != nil {
		return fmt.Errorf("smtp helo: %w", err)
	}
	if err := conn.Auth(auth); err != nil {
		return fmt.Errorf("smtp auth: %w", err)
	}
	if err := conn.Mail(from); err != nil {
		return fmt.Errorf("smtp mail from: %w", err)
	}
	if err := conn.Rcpt(to); err != nil {
		return fmt.Errorf("smtp rcpt to: %w", err)
	}
	w, err := conn.Data()
	if err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}
	_, err = w.Write(msg)
	if err != nil {
		return fmt.Errorf("smtp write: %w", err)
	}
	err = w.Close()
	if err != nil {
		return fmt.Errorf("smtp close data: %w", err)
	}
	return conn.Quit()
}

var Default Sender

// Init configures the default email sender from the provided config. Called
// once at application bootstrap.
func Init(host string, port int, user, pass, from, fromName string) {
	Default = &smtpSender{
		host:     host,
		port:     port,
		user:     user,
		pass:     pass,
		from:     from,
		fromName: fromName,
	}
}
