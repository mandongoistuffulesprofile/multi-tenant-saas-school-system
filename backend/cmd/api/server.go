package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/assessment"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/attendance"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/auth"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/calendar"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/comms"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/compliance"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/config"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/curriculum"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/finance"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/knec"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/learner"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/platform"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/reports"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/school"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/staff"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/structure"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/sync"
)

func Run() error {
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
	authService := auth.NewAuthService(database, jwtManager)
	authHandler := auth.NewHandler(authService, database, jwtManager, redisClient.Client)
	auth.InitResetLimiters(redisClient.Client)

	// In development there is no SMS provider, so OTPs are printed to stdout.
	// This keeps the phone sign-in and password-reset flows usable locally.
	if cfg.AppEnv == "development" {
		auth.SetDevSMSSender()
		log.Printf("OTP delivery: stdout logger (development only)")
	}

	schoolService := school.NewService(database)
	schoolHandler := school.NewHandler(schoolService)

	calendarService := calendar.NewService(database)
	calendarHandler := calendar.NewHandler(calendarService)

	staffService := staff.NewService(database)
	staffHandler := staff.NewHandler(staffService)

	learnerService := learner.NewService(database)
	learnerHandler := learner.NewHandler(learnerService)

	curriculumService := curriculum.NewService(database)
	curriculumHandler := curriculum.NewHandler(curriculumService)

	assessmentService := assessment.NewService(database)
	assessmentHandler := assessment.NewHandler(assessmentService)

	knecService := knec.NewService(database)
	knecHandler := knec.NewHandler(knecService)

	reportsService := reports.NewService(database)
	reportsHandler := reports.NewHandler(reportsService)

	commsService := comms.NewService(database)
	commsHandler := comms.NewHandler(commsService)

	complianceService := compliance.NewService(database)
	complianceHandler := compliance.NewHandler(complianceService)

	attendanceService := attendance.NewService(database)
	attendanceHandler := attendance.NewHandler(attendanceService)

	platformService := platform.NewService(database)
	platformHandler := platform.NewHandler(platformService)

	financeService := finance.NewService(database)
	financeHandler := finance.NewHandler(financeService)

	structureService := structure.NewService(database)
	structureHandler := structure.NewHandler(structureService)

	syncService := sync.NewService(database)
	syncHandler := sync.NewHandler(syncService)

	router := gin.Default()
	router.Use(middleware.CORS(os.Getenv("CORS_ALLOWED_ORIGIN")))
	router.Use(middleware.RequestIDMiddleware())
	router.Use(middleware.TenantContextMiddleware(jwtManager, database))

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
		authGroup.POST("/refresh", authHandler.Refresh)
		authGroup.POST("/logout", authHandler.Logout)
		authGroup.POST("/tenant/switch", authHandler.TenantSwitch)
		authGroup.POST("/parent/activate", authHandler.ParentActivate)
		authGroup.POST("/invite/accept", authHandler.InviteAccept)
	}

	// Me routes (authenticated)
	meGroup := apiV1.Group("/me")
	meGroup.Use(middleware.RequireAuth())
	{
		meGroup.GET("", authHandler.GetMe)
		meGroup.PATCH("", authHandler.UpdateMe)
		meGroup.GET("/linked-learners", authHandler.GetLinkedLearners)
		meGroup.GET("/memberships", authHandler.GetMyMemberships)
	}

	// School routes (authenticated, tenant-scoped)
	schoolGroup := apiV1.Group("/school")
	schoolGroup.Use(middleware.RequireAuth())
	{
		schoolGroup.GET("", schoolHandler.GetSchool)
		schoolGroup.PATCH("", middleware.RequireRole(middleware.RoleSchoolAdministrators...), schoolHandler.UpdateSchool)
		schoolGroup.GET("/integrations/channels", schoolHandler.ListPaymentChannels)
		schoolGroup.POST("/integrations/channels", middleware.RequireRole(middleware.RoleFinanceStaff...), schoolHandler.CreatePaymentChannel)
		schoolGroup.GET("/finance-settings", schoolHandler.GetFinanceSettings)
		schoolGroup.PUT("/finance-settings", middleware.RequireRole(middleware.RoleFinanceStaff...), schoolHandler.UpdateFinanceSettings)
	}

	// Calendar routes
	calGroup := apiV1.Group("/calendar")
	calGroup.Use(middleware.RequireAuth())
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
	staffGroup.Use(middleware.RequireAuth())
	{
		staffGroup.GET("", middleware.RequireRole(middleware.RoleAdministrationStaff...), staffHandler.ListStaff)
		staffGroup.POST("", middleware.RequireRole(middleware.RoleSchoolAdministrators...), staffHandler.CreateStaff)
	}

	// Learner routes
	learnerGroup := apiV1.Group("/learners")
	learnerGroup.Use(middleware.RequireAuth())
	{
		learnerGroup.GET("", middleware.RequireRole(middleware.RoleAcademicStaff...), learnerHandler.ListLearners)
		learnerGroup.POST("", middleware.RequireRole(middleware.RoleSchoolAdministrators...), learnerHandler.CreateLearner)
		learnerGroup.GET("/:id", middleware.RequireRole(middleware.RoleAcademicStaff...), learnerHandler.GetLearner)
	}

	// Curriculum routes (M5)
	currGroup := apiV1.Group("/curriculum")
	currGroup.Use(middleware.RequireAuth())
	{
		currGroup.GET("/versions", middleware.RequireRole(middleware.RoleAllStaff...), curriculumHandler.ListCurriculumVersions)
		currGroup.GET("/versions/:version_id", middleware.RequireRole(middleware.RoleAllStaff...), curriculumHandler.GetCurriculumVersion)
		currGroup.GET("/areas", middleware.RequireRole(middleware.RoleAllStaff...), curriculumHandler.ListLearningAreas)
		currGroup.GET("/strands", middleware.RequireRole(middleware.RoleAllStaff...), curriculumHandler.ListStrands)
		currGroup.GET("/sub-strands", middleware.RequireRole(middleware.RoleAllStaff...), curriculumHandler.ListSubStrands)
		currGroup.GET("/pin", middleware.RequireRole(middleware.RoleAllStaff...), curriculumHandler.GetTenantCurriculumPin)
		currGroup.POST("/pin", middleware.RequireRole(middleware.RoleSchoolAdministrators...), curriculumHandler.SetTenantCurriculumPin)
	}

	// Assessment routes (M6)
	assessGroup := apiV1.Group("/assessment")
	assessGroup.Use(middleware.RequireAuth())
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
	knecGroup.Use(middleware.RequireAuth())
	{
		knecGroup.GET("/tools", middleware.RequireRole(middleware.RoleSchoolAdministrators...), knecHandler.ListKNECRules)
		knecGroup.GET("/submissions", middleware.RequireRole(middleware.RoleSchoolAdministrators...), knecHandler.ListKNECRSubmissionStatus)
		knecGroup.GET("/exports", middleware.RequireRole(middleware.RoleSchoolAdministrators...), knecHandler.ListKNECRExportBatches)
	}

	// Finance routes (M10 Money Core)
	financeGroup := apiV1.Group("/finance")
	financeGroup.Use(middleware.RequireAuth())
	{
		// Fee categories — global defaults plus this school's own categories
		financeGroup.GET("/fee-categories", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.ListFeeCategories)
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
		financeGroup.POST("/payments", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.CreatePayment)
		financeGroup.POST("/payments/allocate", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.AllocatePayment)

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
		financeGroup.GET("/mpesa/stk-requests/:id", middleware.RequireRole(middleware.RoleFinanceStaff...), financeHandler.STKStatus)
	}

	// Reports routes (M8)
	reportsGroup := apiV1.Group("/reports")
	reportsGroup.Use(middleware.RequireAuth())
	{
		reportsGroup.GET("/templates", middleware.RequireRole(middleware.RoleAcademicStaff...), reportsHandler.ListReportTemplates)
		reportsGroup.GET("/runs", middleware.RequireRole(middleware.RoleAcademicStaff...), reportsHandler.ListReportRuns)
		reportsGroup.GET("/cards", middleware.RequireRole(middleware.RoleAcademicStaff...), reportsHandler.ListReportCards)
		reportsGroup.GET("/cards/:card_id", middleware.RequireRole(middleware.RoleAcademicStaff...), reportsHandler.GetReportCard)
		reportsGroup.GET("/cards/:card_id/comments", middleware.RequireRole(middleware.RoleAcademicStaff...), reportsHandler.ListReportCardComments)

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
	commsGroup.Use(middleware.RequireAuth())
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
	complianceGroup.Use(middleware.RequireAuth())
	{
		complianceGroup.GET("/consent-notices", middleware.RequireRole(middleware.RoleSchoolAdministrators...), complianceHandler.ListConsentNotices)
		complianceGroup.GET("/consent-records", middleware.RequireRole(middleware.RoleSchoolAdministrators...), complianceHandler.ListConsentRecords)
		complianceGroup.GET("/access-logs", middleware.RequireRole(middleware.RoleSchoolAdministrators...), complianceHandler.ListAccessLogs)
		complianceGroup.GET("/dsr-requests", middleware.RequireRole(middleware.RoleSchoolAdministrators...), complianceHandler.ListDSRRequests)
		complianceGroup.GET("/breach-register", middleware.RequireRole(middleware.RoleSchoolAdministrators...), complianceHandler.ListBreachRegister)

		// Write side
		complianceGroup.POST("/consent-notices", middleware.RequireRole(middleware.RoleSchoolAdministrators...), complianceHandler.CreateConsentNotice)
		complianceGroup.PATCH("/consent-notices/:id", middleware.RequireRole(middleware.RoleSchoolAdministrators...), complianceHandler.UpdateConsentNotice)
		complianceGroup.POST("/consent-records", middleware.RequireRole(middleware.RoleSchoolAdministrators...), complianceHandler.RecordConsent)
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
	attendanceGroup.Use(middleware.RequireAuth())
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
	gateGroup.Use(middleware.RequireAuth())
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
	}

	// Platform routes (M13, M15) — tenant-scoped billing and usage
	platformGroup := apiV1.Group("/platform")
	platformGroup.Use(middleware.RequireAuth())
	{
		platformGroup.GET("/plans", middleware.RequireRole(middleware.RoleSchoolAdministrators...), platformHandler.ListPlans)
		platformGroup.GET("/subscriptions", middleware.RequireRole(middleware.RoleSchoolAdministrators...), platformHandler.ListSubscriptions)
		platformGroup.GET("/invoices", middleware.RequireRole(middleware.RoleSchoolAdministrators...), platformHandler.ListPlatformInvoices)
		platformGroup.GET("/usage", middleware.RequireRole(middleware.RoleSchoolAdministrators...), platformHandler.ListTenantUsage)
		platformGroup.GET("/exports", middleware.RequireRole(middleware.RoleSchoolAdministrators...), platformHandler.ListExports)

		// Write side — tenant registry, billing, reference data and exports
		platformGroup.GET("/tenants", middleware.RequireRole(middleware.RoleSchoolAdministrators...), platformHandler.ListTenants)
		platformGroup.POST("/tenants", middleware.RequireRole(middleware.RoleSchoolAdministrators...), platformHandler.CreateTenant)
		platformGroup.PATCH("/tenants/:id", middleware.RequireRole(middleware.RoleSchoolAdministrators...), platformHandler.UpdateTenant)
		platformGroup.PUT("/tenants/:id/status", middleware.RequireRole(middleware.RoleSchoolAdministrators...), platformHandler.SetTenantStatus)
		platformGroup.GET("/impersonations", middleware.RequireRole(middleware.RoleSchoolAdministrators...), platformHandler.ListImpersonations)
		platformGroup.POST("/impersonations", middleware.RequireRole(middleware.RoleSchoolAdministrators...), platformHandler.CreateImpersonation)
		platformGroup.POST("/impersonations/:id/end", middleware.RequireRole(middleware.RoleSchoolAdministrators...), platformHandler.EndImpersonation)
		platformGroup.POST("/plans", middleware.RequireRole(middleware.RoleSchoolAdministrators...), platformHandler.CreatePlan)
		platformGroup.PATCH("/plans/:id", middleware.RequireRole(middleware.RoleSchoolAdministrators...), platformHandler.UpdatePlan)
		platformGroup.POST("/subscriptions", middleware.RequireRole(middleware.RoleSchoolAdministrators...), platformHandler.UpsertSubscription)
		platformGroup.POST("/exports", middleware.RequireRole(middleware.RoleSchoolAdministrators...), platformHandler.CreateExport)
		platformGroup.GET("/exports/templates", middleware.RequireRole(middleware.RoleSchoolAdministrators...), platformHandler.ExportTemplates)
		platformGroup.POST("/curriculum/versions", middleware.RequireRole(middleware.RoleSchoolAdministrators...), platformHandler.CreateCurriculumVersion)
		platformGroup.POST("/curriculum/versions/:version_id/publish", middleware.RequireRole(middleware.RoleSchoolAdministrators...), platformHandler.PublishCurriculumVersion)
		platformGroup.GET("/weighting-profiles", middleware.RequireRole(middleware.RoleAcademicStaff...), platformHandler.ListWeightingProfiles)
		platformGroup.POST("/weighting-profiles", middleware.RequireRole(middleware.RoleSchoolAdministrators...), platformHandler.CreateWeightingProfile)
		platformGroup.PATCH("/weighting-profiles/:id", middleware.RequireRole(middleware.RoleSchoolAdministrators...), platformHandler.UpdateWeightingProfile)
		platformGroup.POST("/knec/tools", middleware.RequireRole(middleware.RoleSchoolAdministrators...), platformHandler.CreateKNECTool)
		platformGroup.PATCH("/knec/tools/:id", middleware.RequireRole(middleware.RoleSchoolAdministrators...), platformHandler.UpdateKNECTool)
	}

	// Structure routes — grades, streams, class groups and teaching assignments.
	structureGroup := apiV1.Group("/structure")
	structureGroup.Use(middleware.RequireAuth())
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
	}

	// Sync routes — offline queue replay and conflict resolution.
	syncGroup := apiV1.Group("/sync")
	syncGroup.Use(middleware.RequireAuth())
	{
		syncGroup.POST("/push", middleware.RequireRole(middleware.RoleAcademicStaff...), syncHandler.Push)
		syncGroup.GET("/pull", middleware.RequireRole(middleware.RoleAcademicStaff...), syncHandler.Pull)
		syncGroup.GET("/conflicts", middleware.RequireRole(middleware.RoleAcademicStaff...), syncHandler.ListConflicts)
		syncGroup.POST("/conflicts/:id/resolve", middleware.RequireRole(middleware.RoleAcademicStaff...), syncHandler.ResolveConflict)
	}

	// Health check
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy"})
	})

	// Readiness check - verifies DB dependency
	router.GET("/health/ready", func(c *gin.Context) {
		if err := database.DB.PingContext(c); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "unready", "dependency": "database", "error": "database unreachable"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ready"})
	})

	server := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: router,
	}

	go func() {
		log.Printf("Server starting on port %s", cfg.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt)
	<-quit

	log.Println("Shutting down server...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		return err
	}

	return nil
}
