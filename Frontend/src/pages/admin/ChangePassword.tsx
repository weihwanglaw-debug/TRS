/**
 * ChangePassword.tsx
 *
 * Self-service password change. Required when mustChangePassword = true.
 * Calls apiChangePassword() — requires the current password for security.
 *
 * Mock:  validates against mockUserStore in-memory password
 * Real:  swap authApi.ts apiChangePassword() body to fetch() — no changes here
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiChangePassword } from "@/lib/api";

export default function ChangePassword() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [currentPw, setCurrentPw] = useState("");
  const [newPw,     setNewPw]     = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPw,    setShowPw]    = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [errors,    setErrors]    = useState<Record<string, string>>({});
  const [apiError,  setApiError]  = useState("");
  const [success,   setSuccess]   = useState(false);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!currentPw.trim())    e.currentPw = "Required";
    if (!newPw.trim())        e.newPw = "Required";
    else if (newPw.length < 8) e.newPw = "Minimum 8 characters";
    if (newPw !== confirmPw)  e.confirmPw = "Passwords do not match";
    if (newPw === currentPw && newPw.length > 0) e.newPw = "New password must differ from current";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || !user) return;
    setSaving(true);
    setApiError("");
    const r = await apiChangePassword(currentPw, newPw);
    setSaving(false);
    if (r.error) { setApiError(r.error.message); return; }
    setSuccess(true);
    // Force full logout so mustChangePassword flag is cleared from the session.
    // navigate("/admin") alone keeps the stale user object in AuthContext state —
    // only apiGetMe() on boot re-reads the flag, so we must go through login again.
    setTimeout(async () => {
      await logout();
      navigate("/login", { replace: true });
    }, 2000);
  };

  return (
    <div className="max-w-md mx-auto py-12 px-4">
      <div className="flex items-center gap-3 mb-8">
        <KeyRound className="h-6 w-6" style={{ color: "var(--color-primary)" }} />
        <h1 className="font-bold text-2xl">Change Password</h1>
      </div>

      {user?.mustChangePassword && (
        <div className="p-4 mb-6 text-sm"
          style={{ backgroundColor: "var(--badge-soon-bg)", color: "var(--badge-soon-text)" }}>
          Your password was reset by an administrator. You must set a new password to continue.
        </div>
      )}

      {success ? (
        <div className="p-4 text-sm"
          style={{ backgroundColor: "var(--badge-open-bg)", color: "var(--badge-open-text)" }}>
          Password changed successfully. Please log in again…
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          {apiError && (
            <div className="p-3 text-sm"
              style={{ backgroundColor: "var(--badge-closed-bg)", color: "var(--badge-closed-text)" }}>
              {apiError}
            </div>
          )}

          <FF label="Current Password" error={errors.currentPw}>
            <div className="relative">
              <input type={showPw ? "text" : "password"} className="field-input pr-10"
                value={currentPw} onChange={e => setCurrentPw(e.target.value)} />
              <button type="button"
                className="field-input-icon absolute right-3 top-1/2 -translate-y-1/2 opacity-60 hover:opacity-90"
                onClick={() => setShowPw(p => !p)}>
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </FF>

          <FF label="New Password" error={errors.newPw}>
            <input type={showPw ? "text" : "password"} className="field-input"
              value={newPw} onChange={e => setNewPw(e.target.value)}
              placeholder="Minimum 8 characters" />
          </FF>

          <FF label="Confirm New Password" error={errors.confirmPw}>
            <input type={showPw ? "text" : "password"} className="field-input"
              value={confirmPw} onChange={e => setConfirmPw(e.target.value)} />
          </FF>

          <div className="flex gap-3 pt-2">
            {!user?.mustChangePassword && (
              <button type="button" onClick={() => navigate(-1)}
                className="btn-outline px-5 py-2.5 text-sm font-medium">Cancel</button>
            )}
            {user?.mustChangePassword && (
              <button type="button" onClick={() => logout()}
                className="btn-outline px-5 py-2.5 text-sm font-medium">Log Out</button>
            )}
            <button type="submit" disabled={saving}
              className="btn-primary flex-1 py-2.5 text-sm font-semibold disabled:opacity-50">
              {saving ? "Saving…" : "Change Password"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function FF({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-2 opacity-70">{label}</label>
      {children}
      {error && <p className="text-xs mt-1" style={{ color: "var(--badge-open-text)" }}>{error}</p>}
    </div>
  );
}