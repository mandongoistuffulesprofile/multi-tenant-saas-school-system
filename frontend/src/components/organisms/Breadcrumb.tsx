import { NavLink, useLocation } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";

interface BreadcrumbItem {
  label: string;
  path: string;
}

// Route segments are stable API-facing slugs; these are the human labels shown
// in the chrome. Keep this list aligned with App.tsx.
const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  finance: "Finance",
  invoices: "Invoices",
  payments: "Payments",
  mpesa: "M-Pesa Ledger",
  "fee-categories": "Fee Categories",
  "fee-structures": "Fee Structures",
  reconciliation: "Reconciliation",
  "holding-tank": "Holding Tank",
  "board-pack": "Board Pack",
  credits: "Credits",
  adjustments: "Adjustments",
  refunds: "Refunds",
  learners: "Learners",
  students: "Learners",
  "grades-streams": "Grades & Streams",
  "teaching-allocation": "Teaching Allocation",
  staff: "Staff",
  calendar: "Academic Calendar",
  curriculum: "Curriculum",
  assessment: "Assessment",
  assessments: "Assessment",
  reports: "Reports",
  cards: "Report Cards",
  print: "Print",
  attendance: "Attendance",
  knec: "KNEC",
  comms: "Communications",
  compose: "Compose",
  compliance: "Compliance",
  "breach-register": "Breach Register",
  "consent-notices": "Consent Notices",
  "dsr-requests": "DSR Requests",
  school: "School",
  integrations: "Integrations",
  platform: "Platform",
  tenants: "Tenants",
  onboard: "Onboard School",
  setup: "Setup",
  subscriptions: "Subscriptions",
  impersonate: "Impersonate",
  audit: "Audit Log",
  operations: "Operations",
  profile: "Profile",
  parent: "Parent Portal",
  teacher: "Teacher Workspace",
  classes: "My Classes",
  grading: "Grading",
  progress: "Progress",
  evidence: "Evidence",
  remarks: "Remarks",
  sync: "Sync Centre",
};

function isOpaqueID(segment: string) {
  return /^[0-9a-f]{8}-[0-9a-f-]{8,}$/i.test(segment) || /^\d+$/.test(segment);
}

function labelFor(segment: string) {
  if (isOpaqueID(segment)) return "Details";
  return SEGMENT_LABELS[segment] ?? segment.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  if (!items.length) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-gray-100 bg-gray-50 px-4 py-2 text-xs text-gray-500 md:px-6 md:text-sm"
    >
      <ol className="flex items-center gap-1">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const isFirst = index === 0;

          return (
            <li key={`${item.path}-${index}`} className="flex items-center gap-1">
              {!isFirst && (
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-300" aria-hidden="true" />
              )}
              {isLast ? (
                <span
                  className="max-w-[240px] truncate font-medium text-gray-900 md:max-w-[320px]"
                  aria-current="page"
                >
                  {labelFor(item.label)}
                </span>
              ) : (
                <NavLink
                  to={item.path}
                  className="flex items-center gap-1 text-gray-500 transition hover:text-slate-900"
                >
                  {isFirst && item.path === "/" && (
                    <Home className="h-4 w-4" aria-hidden="true" />
                  )}
                  {labelFor(item.label)}
                </NavLink>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function useBreadcrumbs(): BreadcrumbItem[] {
  const location = useLocation();
  const pathnames = location.pathname.split("/").filter(Boolean);

  const items: BreadcrumbItem[] = [{ label: "dashboard", path: "/" }];

  let currentPath = "";
  for (const segment of pathnames) {
    currentPath += `/${segment}`;
    items.push({ label: segment, path: currentPath });
  }

  return items;
}
