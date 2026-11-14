package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/academic"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/admin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/assessment"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/attendance"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/audit"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/auth"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/calendar"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/comms"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/compliance"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/config"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/curriculum"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/customization"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/daraja"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/email"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/finance"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/holdingtank"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/imports"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/inkind"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/kitchen"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/knec"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/learner"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/openingbalance"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/platform"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/reports"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/school"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/sms"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/staff"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/structure"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/sync"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/valueledger"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/wizard"
)

func Run() error {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))

	cfg, err := config.Load()
	if err != nil {
		return err
	}

	database, err := db.Connect(cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer database.Close()

	// Redis — required for rate limiting across multiple instances.
	redisClient, err := middleware.NewRedisClient(cfg.RedisURL)
	if err != nil {
		return fmt.Errorf("redis: %w", err)
	}
	defer redisClient.Close()

	// Redis-backed rate limiters (fail-closed — deny if Redis is down).
	authLimiter := middleware.NewRedisRateLimiter(redisClient.Client, "rl:auth:ip", 600, time.Minute)

	jwtManager := auth.NewJWTManager(cfg.JWTSigningKey, 15*time.Minute, 30*24*time.Hour)
	authService := auth.NewAuthService(cfg.JWTSigningKey)
	authHandler := auth.NewHandler(authService, database, jwtManager, redisClient.Client)
	auth.InitResetLimiters(redisClient.Client)

	// Email sender: SMTP when credentials are configured, otherwise dev/log-only.
	email.Init(
		cfg.SMTPHost, cfg.SMTPPort,
		cfg.SMTPUser, cfg.SMTPPass,
		cfg.SMTPFrom, cfg.SMTPFromName,
	)

	// In development there is no SMS provider, so OTPs are printed to stdout.
	// This keeps the phone sign-in and password-reset flows usable locally.
	if cfg.AppEnv == "development" {
		auth.SetDevSMSSender()
		log.Printf("OTP delivery: stdout logger (development only)")
	}

	auditService := audit.NewService(database)
	auditHandler := audit.NewHandler(auditService)

	schoolService := school.NewService(database)
	schoolHandler := school.NewHandler(schoolService)

	calendarService := calendar.NewService(database)
	calendarHandler := calendar.NewHandler(calendarService)

	staffService := staff.NewService(database)
	smsService := sms.NewSMSService()
	staffHandler := staff.NewHandler(staffService, smsService)

	learnerService := learner.NewService(database)
	learnerHandler := learner.NewHandler(learnerService)

	curriculumService := curriculum.NewService(database)
	curriculumHandler := curriculum.NewHandler(curriculumService)

	customizationService := customization.NewService()
	customizationHandler := customization.NewHandler(customizationService)

	assessmentService := assessment.NewService(database)
	assessmentHandler := assessment.NewHandler(assessmentService)

	knecService := knec.NewService()
	knecHandler := knec.NewHandler(knecService)

	reportsService := reports.NewService(database)
	reportsHandler := reports.NewHandler(reportsService)

	commsService := comms.NewService(database)
	commsHandler := comms.NewHandler(commsService)

	complianceService := compliance.NewService(database)
	complianceHandler := compliance.NewHandler(complianceService)

	attendanceService := attendance.NewService(database)
	attendanceHandler := attendance.NewHandler(attendanceService)

	platformService := platform.NewService(database, jwtManager)
	platformHandler := platform.NewHandler(platformService)

	financeService := finance.NewService(database)
	financeHandler := finance.NewHandler(financeService)

	structureService := structure.NewService(database)
	structureHandler := structure.NewHandler(structureService)

	academicService := academic.NewService(database)
	academicHandler := academic.NewHandler(academicService)

	importsService := imports.NewService(database)
	importsHandler := imports.NewHandler(importsService)

	syncService := sync.NewService()
	syncHandler := sync.NewHandler(syncService)

		inkindService := inkind.NewService(database)
	valueLedgerService := valueledger.NewService(database)
	valueLedgerHandler := valueledger.NewHandler(valueLedgerService)
openingBalanceService := openingbalance.NewService(database)
openingBalanceHandler := openingbalance.NewHandler(openingBalanceService)	holdingtankService := holdingtank.NewService(database)	holdingtankHandler := holdingtank.NewHandler(holdingtankService)
inkindHandler := inkind.NewHandler(inkindService, financeHandler)

	kitchenService := kitchen.NewService(database)
	kitchenHandler := kitchen.NewHandler(kitchenService)

	adminService := admin.NewService(database)
	adminHandler := admin.NewHandler(adminService)

	wizardService := wizard.NewService(database)
	wizardHandler := wizard.NewHandler(wizardService)

	// M-Pesa: the callback writes to a durable inbox; a background worker
	// allocates the payment. Fail closed in production if no webhook auth is
	// configured (token or IP allowlist), since Daraja callbacks are unsigned.
	if cfg.AppEnv == "production" {
		if strings.TrimSpace(os.Getenv("MPESA_WEBHOOK_TOKEN")) == "" && strings.TrimSpace(os.Getenv("MPESA_ALLOWED_IPS")) == "" {
			return fmt.Errorf("MPESA_WEBHOOK_TOKEN or MPESA_ALLOWED_IPS must be set in production")
		}
	}
	mpesaHandler := finance.NewMpesaHandler(database.DB.DB)
	allocationWorker := finance.NewAllocationWorker(database.DB.DB, slog.Default())
	allocCtx, stopAlloc := context.WithCancel(context.Background())
	defer stopAlloc()
	go allocationWorker.Start(allocCtx, 15*time.Second)

	// Outbox worker: deliver SMS/receipt/alert events idempotently with retries.
	// Uses the new robust worker with lease timeouts and exponential backoff.
	smsSvc := sms.NewSMSService()
	outboxWorker := newOutboxWorker(database.DB.DB, smsSvc, slog.Default())
	go outboxWorker.Run(allocCtx)

	// STK pusher: dispatches pending M-Pesa STK pushes outside any transaction
	// (no HTTP-in-tx). Picks up requests with status PENDING and no
	// checkout_request_id, calls Daraja, then updates the row in a separate
	// short-lived transaction with RLS context set.
	go func(ctx context.Context) {
		mpesaSvc := daraja.NewMpesaService(database.DB.DB)
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				tx, err := database.BeginTxx(ctx, nil)
				if err != nil {
					continue
				}
				if _, err := tx.ExecContext(ctx, "SET LOCAL app.worker = 'on'"); err != nil {
					tx.Rollback()
					continue
				}
				rows, err := tx.QueryContext(ctx, `
					SELECT stk_id, tenant_id, phone_number, amount, account_reference
					FROM mpesa_stk_requests
					WHERE status = 'PENDING' AND checkout_request_id IS NULL
					ORDER BY created_at ASC
					LIMIT 25
					FOR UPDATE SKIP LOCKED`)
				if err != nil {
					tx.Rollback()
					continue
				}
				type stkReq struct {
					id, tenant, phone, ref string
					amount                 float64
				}
				var reqs []stkReq
				for rows.Next() {
					var r stkReq
					if err := rows.Scan(&r.id, &r.tenant, &r.phone, &r.amount, &r.ref); err == nil {
						reqs = append(reqs, r)
					}
				}
				rows.Close()
				for _, r := range reqs {
					_, _ = tx.ExecContext(ctx, `UPDATE mpesa_stk_requests SET status = 'SENDING' WHERE stk_id = $1`, r.id)
				}
				if err := tx.Commit(); err != nil {
					continue
				}
				// Push outside any transaction (no HTTP-in-tx).
				for _, r := range reqs {
					tenantUUID, _ := uuid.Parse(r.tenant)
					pushed, pushErr := mpesaSvc.InitiateSTKPush(ctx, tenantUUID, daraja.STKPushRequest{
						PhoneNumber: r.phone,
						AmountKES:   int64(r.amount),
						AdmissionNo: r.ref,
					})
					updTx, err := database.BeginTxx(ctx, nil)
					if err != nil {
						continue
					}
					if _, err := updTx.ExecContext(ctx, "SELECT set_config('app.current_tenant_id', $1, true)", r.tenant); err != nil {
						updTx.Rollback()
						continue
					}
					if pushErr != nil {
						_, _ = updTx.ExecContext(ctx, `
							UPDATE mpesa_stk_requests SET status = 'FAILED', callback_payload = jsonb_build_object('error', $2)
							 WHERE stk_id = $1`, r.id, pushErr.Error())
					} else {
						checkoutID, _ := pushed["CheckoutRequestID"].(string)
						merchantID, _ := pushed["MerchantRequestID"].(string)
						payloadJSON, _ := json.Marshal(pushed)
						_, _ = updTx.ExecContext(ctx, `
							UPDATE mpesa_stk_requests SET checkout_request_id = NULLIF($2, ''), merchant_request_id = NULLIF($3, ''),
								callback_payload = COALESCE(callback_payload, '{}'::jsonb) || $4::jsonb
								WHERE stk_id = $1`, r.id, checkoutID, merchantID, string(payloadJSON))
					}
					updTx.Commit()
				}
			}
		}
	}(allocCtx)

	router := gin.New()
	router.SetTrustedProxies([]string{"127.0.0.1", "::1", "172.16.0.0/12", "10.0.0.0/8", "192.168.0.0/16"})
	router.Use(gin.Recovery())
	router.Use(middleware.RequestIDMiddleware())
	router.Use(middleware.RequestLogger())
	router.Use(middleware.MetricsMiddleware())
	router.Use(middleware.SecurityHeaders())
	router.Use(middleware.CORS(os.Getenv("CORS_ALLOWED_ORIGIN")))
	router.Use(middleware.BodyLimit(2 << 20))
	router.Use(middleware.TenantContextMiddleware(jwtManager, database))
	router.Use(middleware.TenantTxMiddleware(database.DB, redisClient.Client))

	// Universal idempotency: state-changing requests carrying an
	// X-Idempotency-Key are replay-protected via Redis. Cached responses are
	// returned without re-invoking the handler (24h TTL).
	router.Use(middleware.IdempotencyMiddleware(redisClient.Client))

	// Buffer GET response bodies so ETags can be computed and If-None-Match
	// answered with 304, cutting repeat fetch payloads on metered connections.
	router.Use(middleware.CaptureBodyMiddleware())
	router.Use(middleware.CacheControlMiddleware())

	// Unknown routes must be a real 404. Gin's default error path can be
	// swallowed by the body-capture writer (it sets the status on writermem
	// rather than through c.Writer), which previously produced 200 with an
	// empty body. That made every not-yet-implemented endpoint look successful
	// to the SPA. Explicit JSON handlers keep the contract honest.
	router.NoRoute(func(c *gin.Context) {
		c.JSON(http.StatusNotFound, gin.H{
			"code":       "NOT_FOUND",
			"message":    "Route not found",
			"request_id": c.GetString(middleware.ContextRequestID),
		})
	})
	router.NoMethod(func(c *gin.Context) {
		c.JSON(http.StatusMethodNotAllowed, gin.H{
			"code":       "METHOD_NOT_ALLOWED",
			"message":    "Method not allowed",
			"request_id": c.GetString(middleware.ContextRequestID),
		})
	})

	// Broad per-tenant (or per-IP for anonymous) safety valve. Expensive route
	// groups may add stricter limits later; this prevents one tenant or client
	// from exhausting the API.
	tenantLimiter := middleware.NewRedisRateLimiter(redisClient.Client, "rl:tenant", 600, time.Minute)
	tenantLimit := middleware.RedisRateLimitMiddleware(tenantLimiter, func(c *gin.Context) string {
		if tenant := c.GetString(middleware.ContextTenantID); tenant != "" {
			return tenant
		}
		return "ip:" + c.ClientIP()
	})
	router.Use(func(c *gin.Context) {
		// Probes and provider callbacks must not depend on Redis. The webhook
		// has its own token check, and a Redis outage must not make the service
		// look dead or drop M-Pesa callbacks.
		path := c.Request.URL.Path
		if path == "/health" || path == "/health/ready" || path == "/metrics" || strings.HasPrefix(path, "/webhooks/") {
			c.Next()
			return
		}
		tenantLimit(c)
	})

	// Public Safaricom callbacks. Authentication is the shared webhook token/IP,
	// not a user JWT; they must stay outside authenticated groups.
	router.POST("/webhooks/mpesa/c2b", mpesaHandler.HandleC2BConfirmation)
	router.POST("/webhooks/mpesa/stk", mpesaHandler.HandleSTKCallback)

	// Outbound SMS dispatcher: drains QUEUED outbound_messages (SMS) with retries.
	// Follows the outbox pattern: claim inside tx, commit, dispatch outside tx,
	// then resolve status. Never performs HTTP inside an open transaction.
	go func(ctx context.Context) {
		svc := sms.NewSMSService()
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				tx, err := database.BeginTxx(ctx, nil)
				if err != nil {
					slog.Warn("outbound_sms: begin failed", "error", err)
					continue
				}
				if _, err := tx.ExecContext(ctx, "SET LOCAL app.worker = 'on'"); err != nil {
					_ = tx.Rollback()
					continue
				}
				rows, err := tx.QueryContext(ctx, `
					SELECT message_id, tenant_id, recipient_address, body_text
					FROM outbound_messages
					WHERE status = 'QUEUED' AND channel = 'SMS'
					ORDER BY created_at
					LIMIT 50
					FOR UPDATE SKIP LOCKED`)
				if err != nil {
					_ = tx.Rollback()
					continue
				}
				type msg struct{ id, tenant, to, body string }
				msgs := []msg{}
				for rows.Next() {
					var m msg
					if err := rows.Scan(&m.id, &m.tenant, &m.to, &m.body); err == nil {
						msgs = append(msgs, m)
					}
				}
				rows.Close()

				// Mark claimed messages as SENDING so they are not reclaimed.
				for _, m := range msgs {
					_, _ = tx.ExecContext(ctx, `
						UPDATE outbound_messages SET status = 'SENDING', updated_at = now()
						WHERE message_id = $1 AND tenant_id = $2`, m.id, m.tenant)
				}
				if err := tx.Commit(); err != nil {
					slog.Warn("outbound_sms: commit failed", "error", err)
					continue
				}

				// Dispatch SMS outside the transaction (no HTTP-in-tx).
				for _, m := range msgs {
					dispatchTx, err := database.BeginTxx(ctx, nil)
					if err != nil {
						continue
					}
					if _, err := dispatchTx.ExecContext(ctx, "SELECT set_config('app.current_tenant_id', $1, true)", m.tenant); err != nil {
						dispatchTx.Rollback()
						continue
					}
					// Respect SMS opt-outs (guardian/user linked by phone).
					var optedOut int
					_ = dispatchTx.QueryRowContext(ctx, `
						SELECT COUNT(*) FROM opt_outs o
						 JOIN guardians g ON g.user_id = o.user_id AND g.tenant_id = $1
						WHERE o.tenant_id = $1 AND o.channel = 'SMS' AND o.is_active = true
						  AND g.phone_number = $2`, m.tenant, m.to).Scan(&optedOut)
					if optedOut == 0 {
						_ = dispatchTx.QueryRowContext(ctx, `
							SELECT COUNT(*) FROM opt_outs o
							 JOIN users u ON u.user_id = o.user_id
							WHERE o.tenant_id = $1 AND o.channel = 'SMS' AND o.is_active = true
							  AND u.phone_number = $2`, m.tenant, m.to).Scan(&optedOut)
					}
					if optedOut > 0 {
						_, _ = dispatchTx.ExecContext(ctx, `
							UPDATE outbound_messages SET status = 'SKIPPED', error_message = 'opted_out', updated_at = now()
							WHERE message_id = $1 AND tenant_id = $2`, m.id, m.tenant)
						dispatchTx.Commit()
						continue
					}
					sendErr := svc.SendSMS(ctx, m.to, m.body)
					if sendErr != nil {
						_, _ = dispatchTx.ExecContext(ctx, `
							UPDATE outbound_messages
							SET status = 'FAILED',
							    provider_response = jsonb_set(COALESCE(provider_response,'{}'::jsonb), '{attempts}', to_jsonb(1), true),
							    error_message = $2, updated_at = now()
							WHERE message_id = $1 AND tenant_id = $3`, m.id, sendErr.Error(), m.tenant)
						dispatchTx.Commit()
						continue
					}
					_, _ = dispatchTx.ExecContext(ctx, `
						UPDATE outbound_messages
						SET status = 'SENT', sent_at = now(), error_message = NULL, updated_at = now()
						WHERE message_id = $1 AND tenant_id = $2`, m.id, m.tenant)
					dispatchTx.Commit()
				}
			}
		}
	}(allocCtx)

	apiV1 := router.Group("/api/v1")

	// Auth routes (public) — Redis-backed rate limiting.
	authGroup := apiV1.Group("/auth")
	{
		authGroup.Use(middleware.RedisRateLimitMiddleware(authLimiter, func(c *gin.Context) string {
			return c.ClientIP()
		}))
		authGroup.POST("/login", authHandler.Login)
		authGroup.POST("/otp/request", authHandler.RequestOTP)
		authGroup.POST("/otp/verify", authHandler.VerifyOTP)
		authGroup.POST("/password/reset/request", authHandler.RequestPasswordReset)
		authGroup.POST("/password/reset/confirm", authHandler.ConfirmPasswordReset)
		authGroup.POST("/password/reset", authHandler.ResetPasswordWithOTP)
		// Free recovery path: security questions and platform-admin support codes.
		authGroup.GET("/recovery/questions", authHandler.ListRecoveryQuestionCatalog)
		authGroup.POST("/password/reset/questions", authHandler.RecoveryQuestions)
		authGroup.POST("/password/reset/answers", authHandler.ResetWithAnswers)
		authGroup.POST("/password/reset/assistance", authHandler.RequestPasswordAssistance)
		authGroup.POST("/password/reset/code", authHandler.ResetWithSupportCode)
		authGroup.POST("/refresh", authHandler.Refresh)
		authGroup.POST("/logout", authHandler.Logout)
		authGroup.POST("/tenant/switch", authHandler.TenantSwitch)
		authGroup.POST("/parent/activate", authHandler.ParentActivate)
		authGroup.POST("/invite/accept", authHandler.InviteAccept)
	}

	// Me routes (authenticated)
	meGroup := apiV1.Group("/me")
	meGroup.Use(middleware.RequireAuthGin(jwtManager))
	{
		meGroup.GET("", authHandler.GetMe)
		meGroup.PATCH("", authHandler.UpdateMe)
		meGroup.GET("/security-questions", authHandler.GetMySecurityQuestions)
		meGroup.PUT("/security-questions", authHandler.SetMySecurityQuestions)
		meGroup.GET("/linked-learners", authHandler.GetLinkedLearners)
		meGroup.GET("/memberships", authHandler.GetMyMemberships)
	}

	// School routes (authenticated, tenant-scoped)
	schoolGroup := apiV1.Group("/school")
	schoolGroup.Use(middleware.RequireAuthGin(jwtManager))
	{
		schoolGroup.GET("", schoolHandler.GetSchool)
		schoolGroup.PATCH("", middleware.RequireRole(middleware.RoleSchoolAdministrators...), schoolHandler.UpdateSchool)
		schoolGroup.GET("/integrations/channels", schoolHandler.ListPaymentChannels)
		schoolGroup.POST("/integrations/channels", middleware.RequireRole(middleware.RoleFinanceStaff...), schoolHandler.CreatePaymentChannel)
		schoolGroup.GET("/finance-settings", schoolHandler.GetFinanceSettings)
		schoolGroup.PUT("/finance-settings", middleware.RequireRole(middleware.RoleFinanceStaff...), schoolHandler.UpdateFinanceSettings)
	}

	apiV1.GET("/audit/logs", middleware.RequireAuthGin(jwtManager), middleware.RequireRole(middleware.RoleSchoolAdministrators...), auditHandler.GetAuditLog)

	kitchenGroup := apiV1.Group("/kitchen")
	kitchenGroup.Use(middleware.RequireAuthGin(jwtManager))
	kitchenGroup.GET("/recipes", kitchenHandler.ListRecipes)
	kitchenGroup.POST("/recipes", middleware.RequireRole(middleware.RoleSchoolAdministrators...), kitchenHandler.CreateRecipe)
	kitchenGroup.POST("/requisitions", middleware.RequireRole(middleware.RoleFinanceStaff...), kitchenHandler.CreateRequisition)
	kitchenGroup.GET("/requisitions/:id", middleware.RequireRole(middleware.RoleFinanceStaff...), kitchenHandler.GetRequisition)
	kitchenGroup.POST("/requisitions/:id/process", middleware.RequireRole(middleware.RoleFinanceStaff...), kitchenHandler.ProcessRequisition)
	kitchenGroup.POST("/requisitions/:id/approve", middleware.RequireRole(middleware.RoleSchoolAdministrators...), kitchenHandler.ApproveRequisition)
	kitchenGroup.POST("/requisitions/:id/reject", middleware.RequireRole(middleware.RoleSchoolAdministrators...), kitchenHandler.RejectRequisition)
	adminGroup := apiV1.Group("/admin")
	adminGroup.Use(middleware.RequireAuthGin(jwtManager))
	adminGroup.GET("/settings", adminHandler.ListInKindSettings)
	adminGroup.PUT("/settings", middleware.RequireRole(middleware.RoleSchoolAdministrators...), adminHandler.UpsertInKindSetting)

	wizardGroup := apiV1.Group("/wizard")
	wizardGroup.Use(middleware.RequireAuthGin(jwtManager))
	wizardGroup.GET("/state", wizardHandler.GetState)
	wizardGroup.PUT("/state", wizardHandler.UpsertState)

	inkindGroup := apiV1.Group("/inkind")
	inkindGroup.Use(middleware.RequireAuthGin(jwtManager))
	inkindGroup.GET("/items", inkindHandler.ListItems)
	inkindGroup.POST("/items", middleware.RequireRole(middleware.RoleSchoolAdministrators...), inkindHandler.CreateItem)
	inkindGroup.GET("/rates", inkindHandler.ListRates)
	inkindGroup.POST("/rates", middleware.RequireRole(middleware.RoleSchoolAdministrators...), inkindHandler.CreateRate)
	inkindGroup.POST("/intakes", middleware.RequireRole(middleware.RoleFinanceStaff...), inkindHandler.CreateIntake)
	inkindGroup.GET("/intakes", inkindHandler.ListIntakes)
	inkindGroup.POST("/intakes/:id/void", middleware.RequireRole(middleware.RoleSchoolAdministrators...), inkindHandler.VoidIntake)

	// In-kind: detail, lines, FIFO lots, current rate
	inkindGroup.GET("/intakes/:id/verify", middleware.RequireRole(middleware.RoleFinanceStaff...), inkindHandler.VerifyIntake)
	inkindGroup.GET("/intakes/:id", middleware.RequireRole(middleware.RoleFinanceStaff...), inkindHandler.GetIntake)
	inkindGroup.GET("/intakes/:id/lines", middleware.RequireRole(middleware.RoleFinanceStaff...), inkindHandler.IntakeLines)
	inkindGroup.GET("/items/:id/lots", middleware.RequireAuthGin(jwtManager), inkindHandler.LotsForItem)
	inkindGroup.GET("/rates/:id", middleware.RequireAuthGin(jwtManager), inkindHandler.CurrentRate)

	vlGroup := apiV1.Group("/value-ledger")
	vlGroup.Use(middleware.RequireAuthGin(jwtManager))
	vlGroup.GET("/metrics", valueLedgerHandler.GetMetrics)

	obGroup := apiV1.Group("/opening-balances")
	obGroup.Use(middleware.RequireAuthGin(jwtManager))
	obGroup.POST("/student-arrears", middleware.RequireRole(middleware.RoleSchoolAdministrators...), openingBalanceHandler.PostStudentArrears)
	obGroup.POST("/opening-stock", middleware.RequireRole(middleware.RoleSchoolAdministrators...), openingBalanceHandler.PostOpeningStock)

	holdingGroup := apiV1.Group("/holding-tank")
	holdingGroup.Use(middleware.RequireAuthGin(jwtManager))
	holdingGroup.GET("", middleware.RequireRole(middleware.RoleFinanceStaff...), holdingtankHandler.ListHoldingTank)
	holdingGroup.POST("/:id/resolve", middleware.RequireRole(middleware.RoleFinanceStaff...), holdingtankHandler.ResolveHoldingTank)
	holdingGroup.GET("/:id/match", middleware.RequireRole(middleware.RoleFinanceStaff...), holdingtankHandler.MatchHoldingEntry)

	tokenGroup := apiV1.Group("/delegated-tokens")
	tokenGroup.Use(middleware.RequireAuthGin(jwtManager))
	tokenGroup.GET("", middleware.RequireRole(middleware.RoleSchoolAdministrators...), holdingtankHandler.ListTokens)
	tokenGroup.POST("", middleware.RequireRole(middleware.RoleSchoolAdministrators...), holdingtankHandler.CreateToken)
	tokenGroup.POST("/:id/revoke", middleware.RequireRole(middleware.RoleSchoolAdministrators...), holdingtankHandler.RevokeToken)
	// Token validation is called from kiosk/parent devices that hold a token
	// but no session; require auth so it can't be used as an open validator.
	apiV1.GET("/delegated-tokens/validate", middleware.RequireAuthGin(jwtManager), holdingtankHandler.ValidateToken)

	// Calendar routes
	calGroup := apiV1.Group("/calendar")
	calGroup.Use(middleware.RequireAuthGin(jwtManager))
	{
		calGroup.GET("/years", middleware.RequireRole(middleware.RoleAdministrationStaff...), calendarHandler.ListAcademicYears)
		calGroup.POST("/years", middleware.RequireRole(middleware.RoleSchoolAdministrators...), calendarHandler.CreateAcademicYear)
		calGroup.GET("/terms", middleware.RequireRole(middleware.RoleAdministrationStaff...), calendarHandler.ListTerms)
		calGroup.POST("/terms", middleware.RequireRole(middleware.RoleSchoolAdministrators...), calendarHandler.CreateTerm)
		calGroup.GET("/exam-windows", middleware.RequireRole(middleware.RoleAcademicStaff...), calendarHandler.ListExamWindows)
		calGroup.POST("/exam-windows", middleware.RequireRole(middleware.RoleSchoolAdministrators...), calendarHandler.CreateExamWindow)
	}

	// Staff routes
	staffGroup := apiV1.Group("/staff")
	staffGroup.Use(middleware.RequireAuthGin(jwtManager))
	{
		staffGroup.GET("", middleware.RequireRole(middleware.RoleAdministrationStaff...), staffHandler.ListStaff)
		staffGroup.POST("", middleware.RequireRole(middleware.RoleSchoolAdministrators...), staffHandler.CreateStaff)
	}

	// Learner routes
	learnerGroup := apiV1.Group("/learners")
	learnerGroup.Use(middleware.RequireAuthGin(jwtManager))
	{
		learnerGroup.GET("", middleware.RequireRole(middleware.RoleAcademicStaff...), learnerHandler.ListLearners)
		learnerGroup.POST("", middleware.RequireRole(middleware.RoleSchoolAdministrators...), learnerHandler.CreateLearner)
		learnerGroup.GET("/:id", middleware.RequireRole(middleware.RoleAcademicStaff...), learnerHandler.GetLearner)
		learnerGroup.PATCH("/:id", middleware.RequireRole(middleware.RoleSchoolAdministrators...), learnerHandler.UpdateLearner)
		learnerGroup.POST("/termination", middleware.RequireRole(middleware.RoleSchoolAdministrators...), learnerHandler.TerminateLearners)
	}

	// Curriculum routes (M5)
	currGroup := apiV1.Group("/curriculum")
	currGroup.Use(middleware.RequireAuthGin(jwtManager))
	{
		currReadRoles := append(append([]string{}, middleware.RoleAllStaff...), middleware.RolePlatformAdministrators...)
		currGroup.GET("/versions", middleware.RequireRole(currReadRoles...), curriculumHandler.ListCurriculumVersions)
		currGroup.GET("/versions/:version_id", middleware.RequireRole(currReadRoles...), curriculumHandler.GetCurriculumVersion)
		currGroup.GET("/areas", middleware.RequireRole(currReadRoles...), curriculumHandler.ListLearningAreas)
		currGroup.GET("/strands", middleware.RequireRole(currReadRoles...), curriculumHandler.ListStrands)
		currGroup.GET("/sub-strands", middleware.RequireRole(currReadRoles...), curriculumHandler.ListSubStrands)
		currGroup.GET("/pin", middleware.RequireRole(currReadRoles...), curriculumHandler.GetTenantCurriculumPin)
		currGroup.POST("/pin", middleware.RequireRole(middleware.RoleSchoolAdministrators...), curriculumHandler.SetTenantCurriculumPin)

		// School-owned additions to the CBC catalogue (electives such as
		// French, Coding or Music). Published areas stay in /curriculum/areas.
		currGroup.GET("/tenant-areas", middleware.RequireRole(currReadRoles...), customizationHandler.ListTenantLearningAreas)
		currGroup.POST("/tenant-areas", middleware.RequireRole(middleware.RoleSchoolAdministrators...), customizationHandler.CreateTenantLearningArea)
		currGroup.PATCH("/tenant-areas/:id", middleware.RequireRole(middleware.RoleSchoolAdministrators...), customizationHandler.UpdateTenantLearningArea)
		currGroup.DELETE("/tenant-areas/:id", middleware.RequireRole(middleware.RoleSchoolAdministrators...), customizationHandler.DeleteTenantLearningArea)
	}

	// Transport zones: tiered day-scholar routes, priced one-way or two-way.
	transportGroup := apiV1.Group("/transport")
	transportGroup.Use(middleware.RequireAuthGin(jwtManager))
	{
		transportGroup.GET("/zones", middleware.RequireRole(middleware.RoleAcademicStaff...), customizationHandler.ListTransportZones)
		transportGroup.POST("/zones", middleware.RequireRole(middleware.RoleSchoolAdministrators...), customizationHandler.CreateTransportZone)
		transportGroup.PATCH("/zones/:id", middleware.RequireRole(middleware.RoleSchoolAdministrators...), customizationHandler.UpdateTransportZone)
		transportGroup.DELETE("/zones/:id", middleware.RequireRole(middleware.RoleSchoolAdministrators...), customizationHandler.DeleteTransportZone)
	}

	// Assessment routes (M6)
	assessGroup := apiV1.Group("/assessment")
	assessGroup.Use(middleware.RequireAuthGin(jwtManager))
	{
		assessGroup.GET("/events", middleware.RequireRole(middleware.RoleAcademicStaff...), assessmentHandler.ListAssessmentEvents)
		assessGroup.GET("/events/:event_id", middleware.RequireRole(middleware.RoleAcademicStaff...), assessmentHandler.GetAssessmentEvent)
		assessGroup.GET("/results", middleware.RequireRole(middleware.RoleAcademicStaff...), assessmentHandler.ListAssessmentResults)
		assessGroup.GET("/results/:result_id", middleware.RequireRole(middleware.RoleAcademicStaff...), assessmentHandler.GetAssessmentResult)
		assessGroup.GET("/weighting-profiles", middleware.RequireRole(middleware.RoleAcademicStaff...), assessmentHandler.ListWeightingProfiles)

		// Write side
		assessGroup.POST("/events", middleware.RequireRole(middleware.RoleSchoolAdministrators...), assessmentHandler.CreateAssessmentEvent)
		assessGroup.PATCH("/events/:event_id", middleware.RequireRole(middleware.RoleSchoolAdministrators...), assessmentHandler.UpdateAssessmentEvent)
		assessGroup.GET("/events/:event_id/grid", middleware.RequireRole(middleware.RoleAcademicStaff...), assessmentHandler.EventGrid)
		assessGroup.POST("/results", middleware.RequireRole(middleware.RoleAcademicStaff...), assessmentHandler.UpsertResult)
		assessGroup.POST("/results/batch", middleware.RequireRole(middleware.RoleAcademicStaff...), assessmentHandler.BatchUpsertResults)
		assessGroup.POST("/results/:result_id/reopen", middleware.RequireRole(middleware.RoleAcademicStaff...), assessmentHandler.ReopenResult)
		assessGroup.POST("/results/competency", middleware.RequireRole(middleware.RoleAcademicStaff...), assessmentHandler.UpsertCompetency)
		assessGroup.POST("/results/evidence", middleware.RequireRole(middleware.RoleAcademicStaff...), assessmentHandler.CreateEvidence)
		assessGroup.POST("/learners/:id/remarks", middleware.RequireRole(middleware.RoleAcademicStaff...), assessmentHandler.UpsertLearnerRemark)
		assessGroup.GET("/moderation-queue", middleware.RequireRole(middleware.RoleAcademicStaff...), assessmentHandler.ModerationQueue)
		assessGroup.POST("/moderation", middleware.RequireRole(middleware.RoleSchoolAdministrators...), assessmentHandler.ModerateResults)
	}

	// KNEC routes (M7)
	knecGroup := apiV1.Group("/knec")
	knecGroup.Use(middleware.RequireAuthGin(jwtManager))
	{
		knecGroup.GET("/tools", middleware.RequireRole(middleware.RoleSchoolAdministrators...), knecHandler.ListKNECRules)
		knecGroup.GET("/submissions", middleware.RequireRole(middleware.RoleSchoolAdministrators...), knecHandler.ListKNECRSubmissionStatus)
		knecGroup.GET("/exports", middleware.RequireRole(middleware.RoleSchoolAdministrators...), knecHandler.ListKNECRExportBatches)
	}

	// Finance routes (M10 Money Core)
	financeGroup := apiV1.Group("/finance")
	financeGroup.Use(middleware.RequireAuthGin(jwtManager))
	{
		// Fee categories — global defaults plus this school's own categories
		financeGroup.GET("/fee-categories", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.ListFeeCategories)
		financeGroup.GET("/fee-categories/templates", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.GetFeeCategoryTemplates)
		financeGroup.POST("/fee-categories", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.CreateFeeCategory)
		financeGroup.PATCH("/fee-categories/:id", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.UpdateFeeCategory)
		financeGroup.DELETE("/fee-categories/:id", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.DeleteFeeCategory)

		// Fee structures
		financeGroup.GET("/fee-structures", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.ListFeeStructures)
		financeGroup.POST("/fee-structures", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.CreateFeeStructure)

		// Learner fee options
		financeGroup.GET("/learners/:learner_id/fee-options", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.ListLearnerFeeOptions)
		financeGroup.POST("/learners/:learner_id/fee-options", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.UpsertLearnerFeeOption)

		// Invoices
		financeGroup.GET("/invoices", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.ListInvoices)
		financeGroup.POST("/invoices", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.CreateInvoice)
		financeGroup.GET("/invoices/:invoice_id/lines", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.ListInvoiceLines)
		financeGroup.POST("/invoices/:invoice_id/lines", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.CreateInvoiceLine)

		// Payments
		financeGroup.GET("/payments", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.ListPayments)
		financeGroup.POST("/payments", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.RecordPayment)
		financeGroup.POST("/payments/allocate", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.AllocatePayment)

		// M-Pesa inbox reconciliation
		financeGroup.GET("/mpesa/events", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.ListMPESAEvents)
		financeGroup.PATCH("/mpesa/events/:id/resolve", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.ResolveMPESAEvent)

		// Credits
		financeGroup.GET("/credits", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.ListCredits)
		financeGroup.POST("/credits", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.CreateCredit)

		// Adjustments
		financeGroup.GET("/adjustments", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.ListAdjustments)
		financeGroup.POST("/adjustments", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.CreateAdjustment)

		// Refunds
		financeGroup.GET("/refunds", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.ListRefunds)
		financeGroup.POST("/refunds", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.CreateRefund)

		// M-Pesa transactions
		financeGroup.GET("/mpesa/transactions", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.ListMPESATransactions)
		financeGroup.POST("/mpesa/transactions", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.CreateMPESATransaction)
		financeGroup.POST("/mpesa/stk-requests", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.CreateMPESASTKRequest)

		// Personas: parents/guardians pay their own linked learners' invoices
		// and poll their own STK request status. Invoice linkage, amount
		// ceiling and channel resolution are enforced server-side.
		financeGroup.POST("/parent/mpesa/stk-requests", middleware.RequireRole(middleware.RoleParent, middleware.RoleGuardian), financeHandler.CreateParentMPESASTKRequest)
		financeGroup.GET("/parent/mpesa/stk-requests/:id", middleware.RequireRole(middleware.RoleParent, middleware.RoleGuardian), financeHandler.ParentMPESASTKStatus)

		// Receipt sequences
		financeGroup.GET("/receipt-sequences/:period", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.GetReceiptSequence)
		financeGroup.POST("/receipt-sequences/:sequence_id/increment", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.IncrementReceiptSequence)

		// Capitation receipts
		financeGroup.GET("/capitation/receipts", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.ListCapitationReceipts)

		// Reconciliation runs
		financeGroup.GET("/reconciliation/runs", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.ListReconciliationRuns)

		// Write side — invoice runs, arrears, reconciliation, statements, dashboard
		financeGroup.POST("/invoice-runs", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.CreateInvoiceRun)
		financeGroup.GET("/arrears", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.ArrearsReport)
		financeGroup.POST("/arrears/reminders", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.SendArrearsReminders)
		financeGroup.POST("/reconciliation/transactions/:txn_id/match", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.MatchReconciliation)
		financeGroup.POST("/reconciliation/transactions/:txn_id/flag-refund", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.FlagRefundForReconciliation)
		financeGroup.GET("/learners/:learner_id/statement", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.LearnerStatement)
		financeGroup.GET("/dashboard", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.FinanceDashboard)
		financeGroup.POST("/capitation/receipts", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.CreateCapitationReceipt)
		financeGroup.GET("/capitation/compliance", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.CapitationCompliance)
		financeGroup.GET("/mpesa/stk-requests/:id", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.STKStatus)
	}

	// Reports routes (M8)
	reportsGroup := apiV1.Group("/reports")
	reportsGroup.Use(middleware.RequireAuthGin(jwtManager))
	{
		reportsGroup.GET("/templates", middleware.RequireRole(middleware.RoleAcademicStaff...), reportsHandler.ListReportTemplates)
		reportsGroup.GET("/runs", middleware.RequireRole(middleware.RoleAcademicStaff...), reportsHandler.ListReportRuns)
		reportsGroup.GET("/cards", middleware.RequireRole(append(middleware.RoleAcademicStaff, middleware.RoleParent, middleware.RoleGuardian)...), reportsHandler.ListReportCards)
		reportsGroup.GET("/cards/:card_id", middleware.RequireRole(append(middleware.RoleAcademicStaff, middleware.RoleParent, middleware.RoleGuardian)...), reportsHandler.GetReportCard)
		// Print-ready PDF generated server-side from the stored card.
		reportsGroup.GET("/cards/:card_id/pdf", middleware.RequireRole(append(middleware.RoleAcademicStaff, middleware.RoleParent, middleware.RoleGuardian)...), reportsHandler.GetReportCardPDF)
		reportsGroup.GET("/cards/:card_id/comments", middleware.RequireRole(append(middleware.RoleAcademicStaff, middleware.RoleParent, middleware.RoleGuardian)...), reportsHandler.ListReportCardComments)

		// Write side
		reportsGroup.POST("/templates", middleware.RequireRole(middleware.RoleSchoolAdministrators...), reportsHandler.CreateReportTemplate)
		reportsGroup.PATCH("/templates/:id", middleware.RequireRole(middleware.RoleSchoolAdministrators...), reportsHandler.UpdateReportTemplate)
		reportsGroup.DELETE("/templates/:id", middleware.RequireRole(middleware.RoleSchoolAdministrators...), reportsHandler.DeleteReportTemplate)
		reportsGroup.POST("/runs", middleware.RequireRole(middleware.RoleSchoolAdministrators...), reportsHandler.CreateReportRun)
		reportsGroup.GET("/runs/:run_id", middleware.RequireRole(middleware.RoleAcademicStaff...), reportsHandler.GetReportRun)
		reportsGroup.POST("/runs/:run_id/publish", middleware.RequireRole(middleware.RoleSchoolAdministrators...), reportsHandler.PublishReportRun)
		reportsGroup.POST("/cards/:card_id/comments", middleware.RequireRole(middleware.RoleAcademicStaff...), reportsHandler.UpsertReportCardComment)
		reportsGroup.PUT("/cards/:card_id/head-comment", middleware.RequireRole(middleware.RoleAcademicStaff...), reportsHandler.UpdateReportCardHeadComment)
	}

	// Comms routes (M11)
	commsGroup := apiV1.Group("/comms")
	commsGroup.Use(middleware.RequireAuthGin(jwtManager))
	{
		commsGroup.GET("/templates", middleware.RequireRole(middleware.RoleAdministrationStaff...), commsHandler.ListMessageTemplates)
		commsGroup.GET("/messages", middleware.RequireRole(middleware.RoleAdministrationStaff...), commsHandler.ListOutboundMessages)
		commsGroup.GET("/broadcasts", middleware.RequireRole(middleware.RoleAdministrationStaff...), commsHandler.ListBroadcasts)
		commsGroup.GET("/opt-outs", middleware.RequireRole(middleware.RoleAdministrationStaff...), commsHandler.ListOptOuts)

		// Write side
		commsGroup.POST("/templates", middleware.RequireRole(middleware.RoleAdministrationStaff...), commsHandler.CreateMessageTemplate)
		commsGroup.PATCH("/templates/:id", middleware.RequireRole(middleware.RoleAdministrationStaff...), commsHandler.UpdateMessageTemplate)
		commsGroup.DELETE("/templates/:id", middleware.RequireRole(middleware.RoleAdministrationStaff...), commsHandler.DeleteMessageTemplate)
		commsGroup.POST("/broadcasts", middleware.RequireRole(middleware.RoleSchoolAdministrators...), commsHandler.CreateBroadcast)
		commsGroup.POST("/broadcasts/:id/send", middleware.RequireRole(middleware.RoleSchoolAdministrators...), commsHandler.SendBroadcast)
		commsGroup.POST("/messages", middleware.RequireRole(middleware.RoleAdministrationStaff...), commsHandler.SendMessage)
		commsGroup.POST("/messages/:id/retry", middleware.RequireRole(middleware.RoleAdministrationStaff...), commsHandler.RetryMessage)
		commsGroup.POST("/opt-outs", middleware.RequireRole(middleware.RoleAdministrationStaff...), commsHandler.SetOptOut)
	}

	// Compliance routes (M12) — privacy-sensitive, restricted to school admins
	complianceGroup := apiV1.Group("/compliance")
	complianceGroup.Use(middleware.RequireAuthGin(jwtManager))
	{
		complianceGroup.GET("/consent-notices", middleware.RequireRole(middleware.RoleSchoolAdministrators...), complianceHandler.ListConsentNotices)
		complianceGroup.GET("/consent-records", middleware.RequireRole(middleware.RoleComplianceReaders...), complianceHandler.ListConsentRecords)
		complianceGroup.GET("/access-logs", middleware.RequireRole(middleware.RoleSchoolAdministrators...), complianceHandler.ListAccessLogs)
		complianceGroup.GET("/dsr-requests", middleware.RequireRole(middleware.RoleSchoolAdministrators...), complianceHandler.ListDSRRequests)
		complianceGroup.GET("/breach-register", middleware.RequireRole(middleware.RoleSchoolAdministrators...), complianceHandler.ListBreachRegister)

		// Write side
		complianceGroup.POST("/consent-notices", middleware.RequireRole(middleware.RoleSchoolAdministrators...), complianceHandler.CreateConsentNotice)
		complianceGroup.PATCH("/consent-notices/:id", middleware.RequireRole(middleware.RoleSchoolAdministrators...), complianceHandler.UpdateConsentNotice)
		complianceGroup.POST("/consent-records", middleware.RequireRole(middleware.RoleSchoolAdministrators...), complianceHandler.RecordConsent)
		complianceGroup.PATCH("/consent-records/:id", middleware.RequireRole(middleware.RoleComplianceReaders...), complianceHandler.UpdateConsentRecord)
		complianceGroup.POST("/consent-records/:id/revoke", middleware.RequireRole(middleware.RoleSchoolAdministrators...), complianceHandler.RevokeConsent)
		complianceGroup.POST("/dsr-requests", middleware.RequireRole(middleware.RoleSchoolAdministrators...), complianceHandler.CreateDSRRequest)
		complianceGroup.PATCH("/dsr-requests/:id", middleware.RequireRole(middleware.RoleSchoolAdministrators...), complianceHandler.UpdateDSRRequest)
		complianceGroup.POST("/breach-register", middleware.RequireRole(middleware.RoleSchoolAdministrators...), complianceHandler.CreateBreach)
		complianceGroup.PATCH("/breach-register/:id", middleware.RequireRole(middleware.RoleSchoolAdministrators...), complianceHandler.UpdateBreach)
		complianceGroup.GET("/retention-policies", middleware.RequireRole(middleware.RoleSchoolAdministrators...), complianceHandler.ListRetentionPolicies)
		complianceGroup.POST("/retention-policies", middleware.RequireRole(middleware.RoleSchoolAdministrators...), complianceHandler.UpsertRetentionPolicy)
		complianceGroup.POST("/dpia", middleware.RequireRole(middleware.RoleSchoolAdministrators...), complianceHandler.CreateDPIA)
		complianceGroup.GET("/summary", middleware.RequireRole(middleware.RoleSchoolAdministrators...), complianceHandler.ComplianceSummary)
	}

	// Attendance routes (M9)
	attendanceGroup := apiV1.Group("/attendance")
	attendanceGroup.Use(middleware.RequireAuthGin(jwtManager))
	{
		attendanceGroup.GET("/registers", middleware.RequireRole(middleware.RoleAcademicStaff...), attendanceHandler.ListAttendanceRegisters)
		attendanceGroup.GET("/marks", middleware.RequireRole(middleware.RoleAcademicStaff...), attendanceHandler.ListAttendanceMarks)

		// Write side
		attendanceGroup.POST("/registers", middleware.RequireRole(middleware.RoleAcademicStaff...), attendanceHandler.CreateRegister)
		attendanceGroup.PATCH("/registers/:register_id", middleware.RequireRole(middleware.RoleAcademicStaff...), attendanceHandler.UpdateRegister)
		attendanceGroup.GET("/registers/:register_id/summary", middleware.RequireRole(middleware.RoleAcademicStaff...), attendanceHandler.AttendanceSummary)
		attendanceGroup.POST("/marks", middleware.RequireRole(middleware.RoleAcademicStaff...), attendanceHandler.UpsertMark)
		attendanceGroup.POST("/marks/batch", middleware.RequireRole(middleware.RoleAcademicStaff...), attendanceHandler.BatchUpsertMarks)
	}

	// Gate routes (M9)
	gateGroup := apiV1.Group("/gate")
	gateGroup.Use(middleware.RequireAuthGin(jwtManager))
	{
		gateGroup.GET("/devices", middleware.RequireRole(middleware.RoleSchoolAdministrators...), attendanceHandler.ListGateDevices)
		gateGroup.GET("/tags", middleware.RequireRole(middleware.RoleSchoolAdministrators...), attendanceHandler.ListRFIDTags)
		gateGroup.GET("/events", middleware.RequireRole(middleware.RoleSchoolAdministrators...), attendanceHandler.ListGateEvents)

		// Write side
		gateGroup.GET("/policy", middleware.RequireRole(middleware.RoleSchoolAdministrators...), attendanceHandler.GetGatePolicy)
		gateGroup.PUT("/policy", middleware.RequireRole(middleware.RoleSchoolAdministrators...), attendanceHandler.UpdateGatePolicy)
		gateGroup.POST("/devices", middleware.RequireRole(middleware.RoleSchoolAdministrators...), attendanceHandler.PairDevice)
		gateGroup.POST("/tags", middleware.RequireRole(middleware.RoleSchoolAdministrators...), attendanceHandler.IssueTag)
		gateGroup.POST("/tags/:id/deactivate", middleware.RequireRole(middleware.RoleSchoolAdministrators...), attendanceHandler.DeactivateTag)
		gateGroup.POST("/events", middleware.RequireRole(middleware.RoleSchoolAdministrators...), attendanceHandler.RecordGateEvents)
		gateGroup.POST("/override", middleware.RequireRole(middleware.RoleSchoolAdministrators...), attendanceHandler.OverrideGate)
		gateGroup.POST("/scan", middleware.RequireRole(middleware.RoleAllStaff...), attendanceHandler.ScanGate)
	}

	// Parent / guardian portal routes
	parentGroup := apiV1.Group("/parent")
	parentGroup.Use(middleware.RequireAuthGin(jwtManager), middleware.RequireRole(middleware.RoleParent, middleware.RoleGuardian))
	{
		parentGroup.GET("/attendance", attendanceHandler.ParentAttendance)
	}
	apiV1.GET("/notices/parent",
		middleware.RequireAuthGin(jwtManager),
		middleware.RequireRole(middleware.RoleParent, middleware.RoleGuardian),
		commsHandler.ParentNotices)

	// Platform routes (M13, M15) — tenant-scoped billing and usage
	platformGroup := apiV1.Group("/platform")
	platformGroup.Use(middleware.RequireAuthGin(jwtManager))
	{
		platformGroup.GET("/plans", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.ListPlans)
		platformGroup.GET("/subscriptions", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.ListSubscriptions)
		platformGroup.GET("/invoices", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.ListPlatformInvoices)
		platformGroup.GET("/usage", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.ListTenantUsage)
		platformGroup.GET("/exports", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.ListExports)
		platformGroup.GET("/integrations", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.ListIntegrationHealth)
		platformGroup.GET("/audit", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.ListPlatformAudit)

		// Write side — tenant registry, billing, reference data and exports
		platformGroup.GET("/tenants", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.ListTenants)
		// Password help queue: platform administrators are the last resort when
		// a user cannot answer their recovery questions.
		platformGroup.GET("/password-assistance", middleware.RequireRole(middleware.RolePlatformAdministrators...), authHandler.ListPasswordAssistance)
		platformGroup.POST("/password-assistance/:id/code", middleware.RequireRole(middleware.RolePlatformAdministrators...), authHandler.IssueResetCodeForRequest)
		platformGroup.POST("/password-reset-codes", middleware.RequireRole(middleware.RolePlatformAdministrators...), authHandler.IssueResetCodeByEmail)
		platformGroup.POST("/tenants", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.CreateTenant)
		platformGroup.PATCH("/tenants/:id", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.UpdateTenant)
		platformGroup.PUT("/tenants/:id/status", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.SetTenantStatus)
		platformGroup.GET("/impersonations", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.ListImpersonations)
		platformGroup.POST("/impersonations", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.CreateImpersonation)
		platformGroup.POST("/impersonations/:id/end", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.EndImpersonation)
		platformGroup.GET("/impersonations/:id/token", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.GetImpersonationToken)
		platformGroup.POST("/plans", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.CreatePlan)
		platformGroup.PATCH("/plans/:id", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.UpdatePlan)
		platformGroup.POST("/subscriptions", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.UpsertSubscription)
		platformGroup.POST("/exports", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.CreateExport)
		platformGroup.GET("/exports/templates", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.ExportTemplates)
		platformGroup.POST("/curriculum/versions", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.CreateCurriculumVersion)
		platformGroup.POST("/curriculum/versions/:version_id/publish", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.PublishCurriculumVersion)
		platformGroup.GET("/weighting-profiles", middleware.RequireRole(middleware.RoleAcademicStaff...), platformHandler.ListWeightingProfiles)
		platformGroup.POST("/weighting-profiles", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.CreateWeightingProfile)
		platformGroup.PATCH("/weighting-profiles/:id", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.UpdateWeightingProfile)
		platformGroup.POST("/knec/tools", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.CreateKNECTool)
		platformGroup.PATCH("/knec/tools/:id", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.UpdateKNECTool)

		// Super Admin tenant onboarding/setup (platform-only, tenant-targeted)
		platformGroup.GET("/tenants/:id/setup", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.GetTenantOnboarding)
		platformGroup.PATCH("/tenants/:id/setup/profile", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.SetupProfile)
		platformGroup.POST("/tenants/:id/setup/calendar", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.SetupCalendar)
		platformGroup.POST("/tenants/:id/setup/structure", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.SetupStructure)
		platformGroup.POST("/tenants/:id/setup/finance", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.SetupFinance)
		platformGroup.POST("/tenants/:id/setup/seeds", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.SetupSeeds)
		platformGroup.POST("/tenants/:id/setup/complete", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.CompleteSetup)
		platformGroup.POST("/tenants/:id/setup/handoff", middleware.RequireRole(middleware.RolePlatformAdministrators...), platformHandler.MarkHandoff)
	}

	// Structure routes — grades, streams, class groups and teaching assignments.
	structureGroup := apiV1.Group("/structure")
	structureGroup.Use(middleware.RequireAuthGin(jwtManager))
	{
		structureGroup.GET("/grades", middleware.RequireRole(middleware.RoleAcademicStaff...), structureHandler.ListGrades)
		structureGroup.GET("/streams", middleware.RequireRole(middleware.RoleAcademicStaff...), structureHandler.ListStreams)
		structureGroup.POST("/streams", middleware.RequireRole(middleware.RoleSchoolAdministrators...), structureHandler.CreateStream)
		structureGroup.PATCH("/streams/:id", middleware.RequireRole(middleware.RoleSchoolAdministrators...), structureHandler.UpdateStream)
		structureGroup.DELETE("/streams/:id", middleware.RequireRole(middleware.RoleSchoolAdministrators...), structureHandler.DeleteStream)
		structureGroup.GET("/class-groups", middleware.RequireRole(middleware.RoleAcademicStaff...), structureHandler.ListClassGroups)
		structureGroup.POST("/class-groups", middleware.RequireRole(middleware.RoleSchoolAdministrators...), structureHandler.CreateClassGroup)
		structureGroup.PATCH("/class-groups/:id", middleware.RequireRole(middleware.RoleSchoolAdministrators...), structureHandler.UpdateClassGroup)
		structureGroup.DELETE("/class-groups/:id", middleware.RequireRole(middleware.RoleSchoolAdministrators...), structureHandler.DeleteClassGroup)
		structureGroup.POST("/class-groups/rollover", middleware.RequireRole(middleware.RoleSchoolAdministrators...), structureHandler.RolloverClassGroups)
		structureGroup.GET("/teaching-assignments", middleware.RequireRole(middleware.RoleAcademicStaff...), structureHandler.ListTeachingAssignments)
		structureGroup.POST("/teaching-assignments", middleware.RequireRole(middleware.RoleSchoolAdministrators...), structureHandler.CreateTeachingAssignment)
		structureGroup.DELETE("/teaching-assignments/:id", middleware.RequireRole(middleware.RoleSchoolAdministrators...), structureHandler.DeleteTeachingAssignment)
		structureGroup.GET("/teaching-weekly-load", middleware.RequireRole(middleware.RoleSchoolAdministrators...), structureHandler.ListTeachingWeeklyLoad)
	}

	// Academic year-end workflow — preview and apply learner promotion.
	academicGroup := apiV1.Group("/academic")
	academicGroup.Use(middleware.RequireAuthGin(jwtManager))
	{
		academicGroup.POST("/rollover", middleware.RequireRole(middleware.RoleSchoolAdministrators...), academicHandler.Rollover)
	}

	// Bulk learner intake — CSV preview (dry run) and apply.
	importsGroup := apiV1.Group("/imports")
	importsGroup.Use(middleware.RequireAuthGin(jwtManager))
	{
		importsGroup.POST("/learners", middleware.RequireRole(middleware.RoleSchoolAdministrators...), importsHandler.ImportLearners)
	}

	// Sync routes — offline queue replay and conflict resolution.
	syncGroup := apiV1.Group("/sync")
	syncGroup.Use(middleware.RequireAuthGin(jwtManager))
	{
		syncGroup.POST("/push", middleware.RequireRole(middleware.RoleAcademicStaff...), syncHandler.Push)
		syncGroup.GET("/pull", middleware.RequireRole(middleware.RoleAcademicStaff...), syncHandler.Pull)
		syncGroup.GET("/conflicts", middleware.RequireRole(middleware.RoleAcademicStaff...), syncHandler.ListConflicts)
		syncGroup.POST("/conflicts/:id/resolve", middleware.RequireRole(middleware.RoleAcademicStaff...), syncHandler.ResolveConflict)
		syncGroup.POST("/devices/enroll", middleware.RequireRole(middleware.RoleAcademicStaff...), syncHandler.EnrollDevice)
		syncGroup.GET("/devices", middleware.RequireRole(middleware.RoleAcademicStaff...), syncHandler.ListDevices)
		syncGroup.POST("/devices/:id/revoke", middleware.RequireRole(middleware.RoleSchoolAdministrators...), syncHandler.RevokeDevice)
		syncGroup.GET("/log", middleware.RequireRole(middleware.RoleSchoolAdministrators...), syncHandler.ListSyncLog)
	}

	// Health check
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "healthy",
			"version": os.Getenv("APP_VERSION"),
		})
	})

	// Prometheus-format counters. Protect with METRICS_TOKEN in production or
	// block /metrics at the reverse proxy.
	router.GET("/metrics", middleware.MetricsHandler())

	// Readiness check - verifies DB and Redis dependencies
	router.GET("/health/ready", func(c *gin.Context) {
		if err := database.DB.PingContext(c); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "unready", "dependency": "database", "error": "database unreachable"})
			return
		}
		if err := redisClient.Client.Ping(c.Request.Context()).Err(); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "unready", "dependency": "redis", "error": "redis unreachable"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ready"})
	})

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       90 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	go func() {
		log.Printf("Server starting on port %s", cfg.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")
	stopAlloc()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		return err
	}

	return nil
}
