import { Link } from "react-router-dom";
import { Compass, LayoutDashboard, LifeBuoy } from "lucide-react";

/**
 * Unknown routes used to redirect to /dashboard, which hid broken deep links
 * and made PWA shortcuts appear to work when they pointed at nothing. Show a
 * deliberate recovery screen instead.
 */
export default function NotFoundPage() {
  return (
    <div
      data-page="not-found"
      className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 text-center"
    >
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700">
        <Compass className="h-6 w-6" />
      </div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Page not found</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        This address is not part of your school workspace. Check the link, or return to a workspace
        area below.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          <LayoutDashboard className="h-4 w-4" /> Dashboard
        </Link>
        <Link
          to="/learners"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Learner directory
        </Link>
        <Link
          to="/profile"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          <LifeBuoy className="h-4 w-4" /> Get help
        </Link>
      </div>
    </div>
  );
}
