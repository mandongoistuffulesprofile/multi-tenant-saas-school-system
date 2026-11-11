import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useToast } from "../components/toast/ToastProvider";

const MIN_PASSWORD_LENGTH = 12;

/**
 * Landing page for the one-shot link emailed by
 * POST /auth/password/reset/request: /auth/reset?token=...
 * The token is single-use, expires, and is never stored in the SPA.
 */
export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = (params.get("token") || "").trim();
  const { toast } = useToast();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!token) {
      setError("This reset link is invalid. Request a new one.");
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await api.post("/auth/password/reset/confirm", {
        token,
        new_password: newPassword,
      });
      setDone(true);
      toast("Password reset. Sign in with your new password.", {
        type: "success",
        title: "Success",
      });
    } catch (err: any) {
      setError(
        err.response?.data?.message ||
          "Could not reset the password. The link may be invalid or expired.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md p-6 space-y-6 bg-white rounded-2xl shadow-sm border border-gray-200">
        <div className="text-center">
          <h1 className="text-xl font-bold text-kenyan-red">Reset password</h1>
          <p className="text-gray-600 text-sm">Choose a new password for your account.</p>
        </div>

        {!token && (
          <div className="space-y-4" role="alert">
            <p className="text-sm text-red-600">
              This reset link is missing its token. Request a new link to continue.
            </p>
            <Link to="/forgot-password" className="btn-primary w-full block text-center">
              Request a new link
            </Link>
          </div>
        )}

        {token && done && (
          <div className="text-center space-y-4" role="status" aria-live="polite">
            <h2 className="text-kenyan-green font-semibold">Password updated</h2>
            <p className="text-gray-600 text-sm">
              Your password has been changed. All other sessions were signed out.
            </p>
            <Link to="/login" className="btn-primary w-full block text-center">
              Sign in
            </Link>
          </div>
        )}

        {token && !done && (
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label className="label" htmlFor="reset-new-password">
                New password
              </label>
              <input
                id="reset-new-password"
                type="password"
                className="input-field"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                At least {MIN_PASSWORD_LENGTH} characters.
              </p>
            </div>
            <div>
              <label className="label" htmlFor="reset-confirm-password">
                Confirm password
              </label>
              <input
                id="reset-confirm-password"
                type="password"
                className="input-field"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
            </div>

            {error && (
              <p className="text-sm text-red-600" role="alert" aria-live="assertive">
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? "Saving…" : "Reset password"}
            </button>
          </form>
        )}

        <div className="text-center text-sm">
          <Link to="/login" className="text-kenyan-red hover:underline">
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
