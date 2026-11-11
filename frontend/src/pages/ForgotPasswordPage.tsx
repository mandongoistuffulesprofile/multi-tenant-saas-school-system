import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

type Mode = "questions" | "email" | "code";
type Step = "request" | "questions" | "done";

interface RecoveryQuestion {
  id: number;
  label: string;
}

const MIN_PASSWORD_LENGTH = 12;

/**
 * Free password recovery:
 *  - security questions (no SMS/email cost),
 *  - emailed one-shot link (when SMTP is configured),
 *  - one-time support code issued by a platform administrator (last resort).
 * SMS/OTP recovery is intentionally not part of this page; SMS is used for
 * other workflows.
 */
export default function ForgotPasswordPage() {
  const [mode, setMode] = useState<Mode>("questions");
  const [step, setStep] = useState<Step>("request");
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [questions, setQuestions] = useState<RecoveryQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [assistanceSent, setAssistanceSent] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setStep("request");
    setQuestions([]);
    setAnswers({});
    setNewPassword("");
    setConfirmPassword("");
    setCode("");
    setError("");
    setMessage("");
    setAssistanceSent(false);
  };

  const validateNewPassword = (): boolean => {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return false;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return false;
    }
    return true;
  };

  const handleFindQuestions = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!identifier.trim()) {
      setError("Enter the email address or phone number on your account.");
      return;
    }
    setLoading(true);
    try {
      const response = await api.post("/auth/password/reset/questions", {
        identifier: identifier.trim(),
      });
      setQuestions(response.data?.questions || []);
      setAnswers({});
      setStep("questions");
    } catch (err: any) {
      if (err.response?.status === 404) {
        setError(
          "No security questions are set up for this account yet. Ask a platform administrator for a one-time reset code.",
        );
      } else {
        setError(err.response?.data?.message || "Could not look up recovery questions.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAnswerReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!validateNewPassword()) return;
    if (questions.some((q) => (answers[q.id] || "").trim().length < 2)) {
      setError("Answer all three security questions.");
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/password/reset/answers", {
        identifier: identifier.trim(),
        answers: questions.map((q) => ({ question_id: q.id, answer: answers[q.id] || "" })),
        new_password: newPassword,
      });
      setMessage("Password reset successful. Sign in with your new password.");
      setStep("done");
    } catch (err: any) {
      setError(err.response?.data?.message || "One or more answers are incorrect.");
    } finally {
      setLoading(false);
    }
  };

  const handleEmailRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!email.trim()) {
      setError("Enter the email address on your account.");
      return;
    }
    setLoading(true);
    try {
      const response = await api.post("/auth/password/reset/request", {
        email: email.trim(),
      });
      setMessage(
        response.data?.message ||
          "If an account exists for that email, a reset link has been sent.",
      );
      setStep("done");
    } catch (err: any) {
      setError(err.response?.data?.message || "Could not send the reset link.");
    } finally {
      setLoading(false);
    }
  };

  const handleCodeReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!identifier.trim() || !code.trim()) {
      setError("Enter your email or phone number and the support code.");
      return;
    }
    if (!validateNewPassword()) return;
    setLoading(true);
    try {
      await api.post("/auth/password/reset/code", {
        identifier: identifier.trim(),
        code: code.trim(),
        new_password: newPassword,
      });
      setMessage("Password reset successful. Sign in with your new password.");
      setStep("done");
    } catch (err: any) {
      setError(err.response?.data?.message || "The support code is invalid or has expired.");
    } finally {
      setLoading(false);
    }
  };

  const handleAssistance = async () => {
    setError("");
    const target = identifier.trim() || email.trim();
    if (!target) {
      setError("Enter your email or phone number first so the administrator can find your account.");
      return;
    }
    setLoading(true);
    try {
      const response = await api.post("/auth/password/reset/assistance", {
        identifier: target,
        note: note.trim(),
      });
      setAssistanceSent(true);
      setMessage(
        response.data?.message ||
          "A platform administrator has been notified. They can issue you a one-time reset code.",
      );
    } catch (err: any) {
      setError(err.response?.data?.message || "Could not send the request.");
    } finally {
      setLoading(false);
    }
  };

  const passwordFields = (
    <>
      <div>
        <label className="label" htmlFor="forgot-new-password">
          New password
        </label>
        <input
          id="forgot-new-password"
          type="password"
          className="input-field"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
        <p className="text-xs text-gray-500 mt-1">At least {MIN_PASSWORD_LENGTH} characters.</p>
      </div>
      <div>
        <label className="label" htmlFor="forgot-confirm-password">
          Confirm password
        </label>
        <input
          id="forgot-confirm-password"
          type="password"
          className="input-field"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-lg p-6 space-y-6 bg-white rounded-2xl shadow-sm border border-gray-200">
        <div className="text-center">
          <h1 className="text-xl font-bold text-kenyan-red">Reset password</h1>
          <p className="text-gray-600 text-sm">
            Use your security questions, an email link, or a one-time code from a platform administrator.
          </p>
        </div>

        {step === "request" && (
          <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Reset method">
            {(
              [
                ["questions", "Security questions"],
                ["email", "Email link"],
                ["code", "Support code"],
              ] as [Mode, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={mode === key}
                onClick={() => switchMode(key)}
                className={`px-2 py-2 rounded-lg text-xs sm:text-sm border ${
                  mode === key
                    ? "bg-kenyan-red text-white border-kenyan-red"
                    : "bg-white text-gray-700 border-gray-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {mode === "questions" && step === "request" && (
          <form onSubmit={handleFindQuestions} className="space-y-4" noValidate>
            <div>
              <label className="label" htmlFor="recovery-identifier">
                Email or phone number
              </label>
              <input
                id="recovery-identifier"
                type="text"
                className="input-field"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            {error && (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? "Looking up…" : "Find my questions"}
            </button>
          </form>
        )}

        {mode === "questions" && step === "questions" && (
          <form onSubmit={handleAnswerReset} className="space-y-4" noValidate>
            <p className="text-sm text-gray-600">
              Answer all three questions exactly as you set them up.
            </p>
            {questions.map((q) => (
              <div key={q.id}>
                <label className="label" htmlFor={`answer-${q.id}`}>
                  {q.label}
                </label>
                <input
                  id={`answer-${q.id}`}
                  type="text"
                  className="input-field"
                  value={answers[q.id] || ""}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  autoComplete="off"
                  required
                />
              </div>
            ))}
            {passwordFields}
            {error && (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? "Resetting…" : "Reset password"}
            </button>
          </form>
        )}

        {mode === "email" && step === "request" && (
          <form onSubmit={handleEmailRequest} className="space-y-4" noValidate>
            <div>
              <label className="label" htmlFor="forgot-email">
                Email address
              </label>
              <input
                id="forgot-email"
                type="email"
                className="input-field"
                placeholder="you@school.example"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            {error && (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? "Sending…" : "Send reset link"}
            </button>
            <p className="text-xs text-gray-500">
              The link works once and expires. If email is not configured, use security questions or ask
              a platform administrator.
            </p>
          </form>
        )}

        {mode === "code" && step === "request" && (
          <form onSubmit={handleCodeReset} className="space-y-4" noValidate>
            <div>
              <label className="label" htmlFor="code-identifier">
                Email or phone number
              </label>
              <input
                id="code-identifier"
                type="text"
                className="input-field"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="support-code">
                One-time support code
              </label>
              <input
                id="support-code"
                type="text"
                className="input-field font-mono uppercase tracking-widest"
                placeholder="ABCDE-FGHJK"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                Your platform administrator gives you this after verifying your identity. It works once
                and expires in 30 minutes.
              </p>
            </div>
            {passwordFields}
            {error && (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? "Resetting…" : "Reset with support code"}
            </button>
          </form>
        )}

        {step === "done" && (
          <div className="text-center py-6 space-y-4" role="status" aria-live="polite">
            <h2 className="text-kenyan-green font-semibold">Done</h2>
            <p className="text-gray-600 text-sm">{message}</p>
            {mode !== "email" && (
              <Link to="/login" className="btn-primary w-full block text-center">
                Sign in
              </Link>
            )}
          </div>
        )}

        {mode === "questions" && (
          <div className="border-t border-gray-200 pt-4 space-y-3">
            <p className="text-sm font-semibold text-gray-700">Can't use your questions?</p>
            <p className="text-xs text-gray-500">
              Ask a platform administrator for a one-time reset code. They will verify your identity
              before issuing it.
            </p>
            <input
              type="text"
              className="input-field"
              placeholder="Optional note (e.g. school name, callback number)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label="Note for the platform administrator"
            />
            <button
              type="button"
              onClick={handleAssistance}
              className="btn-secondary w-full"
              disabled={loading || assistanceSent}
            >
              {assistanceSent ? "Request sent" : "Ask a platform administrator"}
            </button>
            {assistanceSent && message && (
              <p className="text-xs text-kenyan-green" role="status">
                {message}
              </p>
            )}
          </div>
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
