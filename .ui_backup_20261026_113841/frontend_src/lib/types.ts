// Typed API models matching backend internal/*/service.go structs.
// Kept in sync with Go JSON tags. Single source of truth for frontend<->API contracts.

export type ID = string;
export type Timestamp = string;

/* ============ Common ============ */

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  data: T[];
  limit: number;
  offset: number;
  total?: number;
}

/* ============ Auth ============ */

export interface TokenPair {
  access_token: string;
  refresh_token: string;
}

export interface LoginRequest {
  identifier: string; // school code / email / phone
  email?: string;
  password: string;
}

export interface LoginResponse {
  token_pair: TokenPair;
  user_id: ID;
  tenant_id: ID;
  roles: string[];
}

export interface MeResponse {
  user_id: ID;
  email: string;
  phone_number?: string;
  tenant_id: ID;
  roles: string[];
  locale: string;
}

export interface LinkedLearner {
  learner_id: ID;
  admission_number: string;
  first_name: string;
  last_name: string;
  grade_label?: string;
  stream_name?: string;
  guardian_phone?: string;
  relationship?: string;
}

export interface OtpRequest {
  phone?: string;
  email?: string;
  purpose: string; // login | password_reset | invite_accept
}

export interface OtpVerify {
  phone?: string;
  email?: string;
  code: string;
  purpose: string;
}

export interface PasswordResetRequest {
  email?: string;
  phone?: string;
}

export interface PasswordResetConfirm {
  token: string;
  new_password: string;
}

export interface RefreshRequest {
  refresh_token: string;
}

export interface LogoutRequest {
  refresh_token?: string;
}

export interface TenantSwitch {
  tenant_id: ID;
}

export interface ParentActivate {
  claim_code: string;
  guardian_phone: string;
  new_password: string;
}

export interface InviteAccept {
  invite_token: string;
  new_password: string;
}

/* ============ Roles ============ */

export const ROLE = {
  SCHOOL_ADMIN: "SCHOOL_ADMIN",
  SAAS_ADMIN: "SAAS_ADMIN",
  HEAD: "HEAD",
  DEPUTY: "DEPUTY",
  BURSAR: "BURSAR",
  CLERK: "CLERK",
  TEACHER: "TEACHER",
  PARENT: "PARENT",
  GUARDIAN: "GUARDIAN",
  GATE: "GATE",
} as const;

export type Role = (typeof ROLE)[keyof typeof ROLE];

export const ALL_ROLES: Role[] = Object.values(ROLE);

/* ============ School (tenants) ============ */

export interface School {
  tenant_id: ID;
  school_name: string;
  subdomain: string;
  knec_code?: string | null;
  kemis_code?: string | null;
  school_type: string; // PUBLIC, PRIVATE, SNE
  funding_mode: string; // PUBLIC, PRIVATE, CUSTOM
  county?: string | null;
  sub_county?: string | null;
  address?: string | null;
  logo_ref?: string | null;
  stamp_ref?: string | null;
  head_signature_ref?: string | null;
  default_locale: string;
  hosts_junior: boolean;
  license_tier: string;
  status: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PaymentChannel {
  channel_id: ID;
  tenant_id: ID;
  channel_type: string; // PAYBILL, TILL, BANK
  shortcode_or_account: string;
  label: string;
  environment: string;
  is_default: boolean;
  status: string;
  reference_format: string;
  routed_fee_categories: string[];
  channel_token: string;
  c2b_registered: boolean;
  created_at: Timestamp;
}

export interface FinanceSettings {
  tenant_id: ID;
  tuition_invoicing: boolean;
  optional_services: boolean;
  capitation_tracking: boolean;
  allowed_fee_categories: string[];
  arrears_reminders: boolean;
  report_withholding: boolean;
  preset_label: string;
}

/* ============ Calendar ============ */

export interface AcademicYear {
  year_id: ID;
  tenant_id: ID;
  year_label: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
}

export interface Term {
  term_id: ID;
  tenant_id: ID;
  year_id: ID;
  term_number: number;
  term_label: string;
  start_date: string;
  end_date: string;
  midterm_start?: string | null;
  midterm_end?: string | null;
  is_current: boolean;
}

export interface ExamWindow {
  window_id: ID;
  tenant_id: ID;
  exam_type: string;
  window_label: string;
  start_date: string;
  end_date: string;
}

/* ============ Staff ============ */

export interface StaffProfile {
  profile_id: ID;
  membership_id: ID;
  tsc_number?: string | null;
  national_id?: string | null;
  subjects: string[];
  employment_date?: string | null;
}

export interface StaffRow {
  membership_id: ID;
  user_id: ID;
  email: string;
  phone_number: string;
  role: string; // HEAD, DEPUTY, BURSAR, CLERK, TEACHER
  status: string;
  tsc_number?: string | null;
  national_id?: string | null;
  subjects: string[];
  employment_date?: string | null;
}

export interface StaffCreateRequest {
  email: string;
  phone_number: string;
  role: string;
  tsc_number?: string;
  subjects?: string[];
  employment_date?: string;
}

/* ============ Learner ============ */

export interface Learner {
  learner_id: ID;
  tenant_id: ID;
  admission_number: string;
  upi_nemis_number?: string | null;
  first_name: string;
  middle_name?: string | null;
  last_name: string;
  date_of_birth?: string | null;
  gender?: string | null;
  photo_ref?: string | null;
  status: string;
  admitted_on?: string | null;
  previous_school?: string | null;
  class_group_id?: ID | null;
  grade_label?: string | null;
  stream_name?: string | null;
  guardian_phone?: string | null;
}

export interface LearnerCreateRequest {
  admission_number: string;
  upi_nemis_number?: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  date_of_birth?: string;
  gender?: string;
  status?: string;
  admitted_on?: string;
  /** DAY = day scholar, BOARDING = boarding */
  boarding_type?: string;
}

/* ============ Curriculum ============ */

export interface CurriculumVersion {
  version_id: ID;
  version_label: string;
  description?: string | null;
  is_published: boolean;
  effective_from?: string | null;
  effective_to?: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface LearningArea {
  area_id: ID;
  version_id: ID;
  code: string;
  name: string;
  description?: string | null;
  grade_band?: string | null;
  sort_order: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Strand {
  strand_id: ID;
  area_id: ID;
  code: string;
  name: string;
  description?: string | null;
  sort_order: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SubStrand {
  sub_strand_id: ID;
  strand_id: ID;
  code: string;
  name: string;
  description?: string | null;
  sort_order: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface TenantCurriculumPin {
  pin_id: ID;
  tenant_id: ID;
  version_id: ID;
  pinned_by?: ID | null;
  pinned_at?: Timestamp | null;
}

/* ============ Assessment ============ */

export interface AssessmentEvent {
  event_id: ID;
  tenant_id: ID;
  term_id: ID;
  grade_id: ID;
  learning_area_id: ID;
  assessment_type: string;
  scoring_mode: string;
  assessment_window: string;
  weighting_profile_id?: ID | null;
  status: string;
  max_score?: number | null;
  created_by?: ID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AssessmentResult {
  result_id: ID;
  tenant_id: ID;
  event_id: ID;
  learner_id: ID;
  sub_strand_id?: ID | null;
  level_code?: string | null; // EE, ME, AE, BE
  points?: number | null;
  raw_score?: number | null;
  max_score?: number | null;
  teacher_id?: ID | null;
  remarks?: string | null;
  client_uuid?: ID | null;
  version: number;
  state: string; // DRAFT, SYNCED, CONFLICT
  device_id?: ID | null;
  client_ts?: Timestamp | null;
  server_ts: Timestamp;
}

export interface WeightingProfile {
  profile_id: ID;
  name: string;
  description?: string | null;
  grade_id: ID;
  weights: string; // JSON
  is_default: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export const LEVEL = {
  EE: "EE",
  ME: "ME",
  AE: "AE",
  BE: "BE",
} as const;

export type LevelCode = (typeof LEVEL)[keyof typeof LEVEL];

/* ============ KNEC ============ */

export interface KNECTool {
  tool_id: ID;
  tool_code: string;
  name: string;
  description?: string | null;
  grade_id: ID;
  assessment_year: number;
  is_active: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface KNECSubmissionStatus {
  submission_id: ID;
  tenant_id: ID;
  tool_id: ID;
  academic_year_id: ID;
  grade_id: ID;
  status: string;
  export_ref?: string | null;
  exported_at?: Timestamp | null;
  confirmed_at?: Timestamp | null;
  created_by?: ID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface KNECExportBatch {
  batch_id: ID;
  tenant_id: ID;
  tool_id: ID;
  batch_reference: string;
  learner_count: number;
  status: string;
  file_ref?: string | null;
  error_message?: string | null;
  created_by?: ID | null;
  created_at: Timestamp;
  completed_at?: Timestamp | null;
}

/* ============ Finance ============ */

export interface FeeCategory {
  category_id: ID;
  code: string;
  name: string;
  description?: string | null;
  is_tuition: boolean;
  is_optional: boolean;
  requires_consent: boolean;
  /** Present only for categories owned by a single school. */
  tenant_id?: ID;
  /** True when the category is a school-owned custom fee type. */
  is_custom?: boolean;
  is_active?: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface FeeCategoryRequest {
  code: string;
  name: string;
  description?: string;
  is_tuition?: boolean;
  is_optional?: boolean;
  requires_consent?: boolean;
  is_active?: boolean;
}

export interface FeeStructure {
  structure_id: ID;
  tenant_id: ID;
  academic_year_id: ID;
  grade_id: ID;
  category_id: ID;
  category_code?: string | null;
  category_name?: string | null;
  amount_per_term: number;
  amount_per_year: number;
  currency: string;
  is_mandatory: boolean;
  payment_frequency: string;
  due_day: number;
  created_by?: ID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface FeeStructureCreate {
  academic_year_id: ID;
  grade_id: ID;
  category_id: ID;
  amount_per_term: number;
  amount_per_year: number;
  currency: string;
  is_mandatory: boolean;
  payment_frequency: string;
  due_day: number;
}

export interface LearnerFeeOption {
  option_id: ID;
  tenant_id: ID;
  learner_id: ID;
  category_id: ID;
  structure_id: ID;
  opted_in: boolean;
  opted_at?: Timestamp | null;
  opted_by?: ID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Invoice {
  invoice_id: ID;
  tenant_id: ID;
  invoice_number: string;
  learner_id: ID;
  academic_year_id: ID;
  term_id?: ID | null;
  status: string; // DRAFT, ISSUED, PARTIALLY_PAID, PAID, VOID
  currency: string;
  total_amount: number;
  amount_paid: number;
  amount_outstanding: number;
  issue_date?: string | null;
  due_date?: string | null;
  paid_at?: Timestamp | null;
  created_by?: ID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface InvoiceLine {
  line_id: ID;
  tenant_id: ID;
  invoice_id: ID;
  category_id: ID;
  category_code?: string | null;
  description: string;
  quantity: number;
  unit_amount: number;
  line_amount: number;
  academic_year_id?: ID | null;
  term_id?: ID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Payment {
  payment_id: ID;
  tenant_id: ID;
  payment_reference: string;
  learner_id: ID;
  source: string; // M-PESA, BANK, CASH, CHEQUE, CAPITATION
  channel_id?: ID | null;
  amount: number;
  currency: string;
  status: string; // PENDING, COMPLETED, FAILED, REVERSED
  mpesa_trans_id?: string | null;
  received_at: Timestamp;
  recorded_by?: ID | null;
  idempotency_key?: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PaymentAllocation {
  allocation_id: ID;
  tenant_id: ID;
  payment_id: ID;
  invoice_id: ID;
  allocated_amount: number;
  allocated_at: Timestamp;
  allocated_by?: ID | null;
  created_at: Timestamp;
}

export interface Credit {
  credit_id: ID;
  tenant_id: ID;
  learner_id: ID;
  amount: number;
  currency: string;
  reason: string;
  source_payment_id?: ID | null;
  expires_at?: string | null;
  created_by?: ID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Adjustment {
  adjustment_id: ID;
  tenant_id: ID;
  invoice_id: ID;
  adjustment_type: string; // DISCOUNT, SURCHARGE, WAIVER, CORRECTION
  amount: number;
  reason: string;
  created_by?: ID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Refund {
  refund_id: ID;
  tenant_id: ID;
  payment_id: ID;
  amount: number;
  currency: string;
  reason: string;
  status: string; // PENDING, COMPLETED, FAILED
  mpesa_b2c_request_id?: string | null;
  processed_at?: Timestamp | null;
  processed_by?: ID | null;
  created_by?: ID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface MPESATransaction {
  trans_id: ID;
  tenant_id: ID;
  channel_id: ID;
  external_trans_id: string;
  shortcode: string;
  channel_type: string;
  bill_ref?: string | null;
  msisdn_masked?: string | null;
  amount: number;
  currency: string;
  status: string;
  transaction_date?: Timestamp | null;
  tenant_resolved: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface MPESASTKRequest {
  stk_id: ID;
  tenant_id: ID;
  channel_id: ID;
  checkout_request_id: string;
  merchant_request_id: string;
  phone_number: string;
  amount: number;
  currency: string;
  account_reference?: string | null;
  transaction_desc?: string | null;
  status: string; // PENDING, SUCCESS, FAILED, CANCELLED, TIMEOUT
  callback_received_at?: Timestamp | null;
  mpesa_trans_id?: ID | null;
  expires_at?: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ReceiptSequence {
  sequence_id: ID;
  tenant_id: ID;
  prefix: string;
  last_number: number;
  reset_frequency: string;
  current_period: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CapitationReceipt {
  receipt_id: ID;
  tenant_id: ID;
  receipt_number: string;
  capitation_period: string;
  learner_count: number;
  amount_per_learner: number;
  total_amount: number;
  currency: string;
  received_at?: Timestamp | null;
  reference?: string | null;
  status: string;
  created_by?: ID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ReconciliationRun {
  run_id: ID;
  tenant_id: ID;
  run_date: string;
  period_start: string;
  period_end: string;
  total_expected: number;
  total_received: number;
  total_outstanding: number;
  unmatched_transactions: number;
  status: string;
  exception_count: number;
  created_by?: ID | null;
  completed_at?: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/* ============ Reports ============ */

export interface ReportTemplate {
  template_id: ID;
  tenant_id: ID;
  template_name: string;
  template_type: string;
  grade_band: string;
  is_default: boolean;
  is_active: boolean;
  created_by?: ID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ReportRun {
  run_id: ID;
  tenant_id: ID;
  template_id: ID;
  academic_year_id: ID;
  term_id?: ID | null;
  grade_id?: ID | null;
  status: string;
  learner_count: number;
  generated_count: number;
  error_message?: string | null;
  created_by?: ID | null;
  created_at: Timestamp;
  completed_at?: Timestamp | null;
}

export interface ReportCard {
  card_id: ID;
  tenant_id: ID;
  run_id: ID;
  learner_id: ID;
  card_number: string;
  academic_year_id: ID;
  term_id?: ID | null;
  grade_id: ID;
  overall_grade?: string | null;
  total_score?: number | null;
  max_score?: number | null;
  percentage?: number | null;
  position?: number | null;
  comment?: string | null;
  head_teacher_comment?: string | null;
  status: string;
  pdf_ref?: string | null;
  published_at?: Timestamp | null;
  published_by?: ID | null;
  created_by?: ID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ReportCardComment {
  comment_id: ID;
  tenant_id: ID;
  card_id: ID;
  learning_area_id: ID;
  comment_text: string;
  teacher_id?: ID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/* ============ Comms ============ */

export interface MessageTemplate {
  template_id: ID;
  tenant_id: ID | null;
  template_name: string;
  channel: string; // SMS, WHATSAPP, EMAIL, IN_APP
  subject?: string | null;
  body_text: string;
  body_html?: string | null;
  is_active: boolean;
  is_default: boolean;
  created_by?: ID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface OutboundMessage {
  message_id: ID;
  tenant_id: ID;
  template_id?: ID | null;
  recipient_type: string;
  recipient_id: ID;
  channel: string;
  recipient_address: string;
  subject?: string | null;
  body_text: string;
  status: string;
  provider_message_id?: string | null;
  sent_at?: Timestamp | null;
  delivered_at?: Timestamp | null;
  read_at?: Timestamp | null;
  error_message?: string | null;
  created_by?: ID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Broadcast {
  broadcast_id: ID;
  tenant_id: ID;
  broadcast_name: string;
  channel: string;
  target_audience: string;
  target_grade_ids?: string | null;
  subject?: string | null;
  body_text: string;
  status: string;
  scheduled_at?: Timestamp | null;
  sent_at?: Timestamp | null;
  completed_at?: Timestamp | null;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  created_by?: ID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface OptOut {
  opt_out_id: ID;
  tenant_id: ID;
  user_id: ID;
  channel: string;
  reason?: string | null;
  opted_out_at: Timestamp;
  opted_back_in_at?: Timestamp | null;
  is_active: boolean;
}

/* ============ Compliance ============ */

export interface ConsentNotice {
  notice_id: ID;
  notice_code: string;
  title: string;
  content_text: string;
  version: number;
  is_active: boolean;
  requires_renewal: boolean;
  renewal_period_days?: number | null;
  created_by?: ID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ConsentRecord {
  consent_id: ID;
  tenant_id: ID;
  user_id: ID;
  notice_id: ID;
  notice_version: number;
  granted: boolean;
  granted_at?: Timestamp | null;
  revoked_at?: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AccessLog {
  log_id: ID;
  tenant_id: ID;
  user_id?: ID | null;
  action: string;
  resource_type: string;
  resource_id: ID;
  ip_address?: string | null;
  accessed_at: Timestamp;
}

export interface DSRRequest {
  request_id: ID;
  tenant_id: ID;
  user_id: ID;
  request_type: string; // ACCESS, RECTIFICATION, ERASURE, PORTABILITY
  status: string; // PENDING, IN_PROGRESS, COMPLETED, REJECTED
  description?: string | null;
  due_date?: string | null;
  created_by?: ID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface BreachRegister {
  breach_id: ID;
  tenant_id: ID;
  breach_title: string;
  description: string;
  discovered_at: Timestamp;
  reported_to_authority: boolean;
  severity: string; // LOW, MEDIUM, HIGH, CRITICAL
  status: string; // OPEN, INVESTIGATING, RESOLVED, CLOSED
  affected_data_subjects: number;
  resolution_notes?: string | null;
  reported_by?: ID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/* ============ Attendance & Gate ============ */

export interface AttendanceRegister {
  register_id: ID;
  tenant_id: ID;
  class_group_id: ID;
  grade_id: ID;
  stream_id: ID;
  academic_year_id: ID;
  term_id: ID;
  register_date: string;
  session_type: string; // MORNING, AFTERNOON, FULL_DAY
  status: string; // OPEN, CLOSED
  marked_by?: ID | null;
  marked_at?: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AttendanceMark {
  mark_id: ID;
  tenant_id: ID;
  register_id: ID;
  learner_id: ID;
  status: string; // PRESENT, ABSENT, LATE, EXCUSED
  marked_by?: ID | null;
  marked_at: Timestamp;
  notes?: string | null;
  created_at: Timestamp;
}

/* ============ Platform (SaaS root) ============ */

export interface Plan {
  plan_id: ID;
  plan_code: string;
  name: string;
  description?: string | null;
  price_monthly: number;
  price_yearly: number;
  currency: string;
  max_learners: number;
  max_staff: number;
  features: string; // JSON
  is_active: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Subscription {
  subscription_id: ID;
  tenant_id: ID;
  plan_id: ID;
  status: string; // ACTIVE, PAST_DUE, CANCELLED, SUSPENDED
  started_at: Timestamp;
  ends_at?: Timestamp | null;
  auto_renew: boolean;
  created_by?: ID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PlatformInvoice {
  invoice_id: ID;
  tenant_id: ID;
  invoice_number: string;
  amount: number;
  currency: string;
  status: string;
  issue_date?: string | null;
  due_date?: string | null;
  paid_at?: Timestamp | null;
  created_by?: ID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface TenantUsage {
  usage_id: ID;
  tenant_id: ID;
  period_month: string;
  active_learners: number;
  active_staff: number;
  sms_sent: number;
  reports_generated: number;
  assessments_recorded: number;
  payments_processed: number;
  storage_mb: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Export {
  export_id: ID;
  tenant_id: ID;
  export_type: string;
  status: string;
  file_ref?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  record_count: number;
  parameters?: string | null;
  error_message?: string | null;
  created_by?: ID | null;
  created_at: Timestamp;
  completed_at?: Timestamp | null;
}
