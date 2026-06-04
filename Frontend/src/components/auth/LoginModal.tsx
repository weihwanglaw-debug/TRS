import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Trophy, Eye, EyeOff } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface LoginModalProps {
  open:    boolean;
  onClose: () => void;
}

export default function LoginModal({ open, onClose }: LoginModalProps) {
  const { login, mustChangePassword } = useAuth();
  const navigate    = useNavigate();
  const location    = useLocation();
  const [email,     setEmail]     = useState("");
  const [password,  setPassword]  = useState("");
  const [showPw,    setShowPw]    = useState(false);
  const [error,     setError]     = useState("");
  const [submitting, setSubmitting] = useState(false);

  // When opened from a public page (landing, event detail) stay on that page.
  // Only redirect to /admin when the user navigated directly to /login.
  const isPublicPage =
    location.pathname === "/" ||
    location.pathname.startsWith("/event/") ||
    location.pathname.startsWith("/payment/");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email || !password) { setError("Please fill in all fields."); return; }

    setSubmitting(true);
    const loginErr = await login(email, password);
    setSubmitting(false);

    if (loginErr) { setError(loginErr); return; }

    setEmail(""); setPassword(""); setError("");
    onClose();

    if (mustChangePassword) {
      navigate("/admin/change-password");
    } else if (!isPublicPage) {
      // Only redirect to admin panel when on a non-public page (/login)
      navigate("/admin");
    }
    // If isPublicPage: stay — page re-renders with isAuthenticated=true,
    // enabling admin tools (override buttons, admin registration flow, etc.)
  };

  const handleCancel = () => {
    setEmail(""); setPassword(""); setError(""); onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleCancel(); }}>
      <DialogContent className="max-w-sm p-0 gap-0"
        style={{ backgroundColor: "var(--color-page-bg)", border: "1px solid var(--color-table-border)" }}>
        <DialogHeader className="p-8 pb-0">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Trophy className="h-6 w-6" style={{ color: "var(--color-primary)" }} />
            <DialogTitle className="font-heading font-bold text-xl">Admin Login</DialogTitle>
          </div>
        </DialogHeader>
        <div className="p-8 pt-4">
          {error && (
            <div className="p-3 mb-4 text-sm"
              style={{ backgroundColor: "var(--badge-open-bg)", color: "var(--badge-open-text)" }}>
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold mb-2 opacity-70">Email</label>
              <input type="email" className="field-input" value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="admin@trs.com" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-2 opacity-70">Password</label>
              <div className="relative">
                <input type={showPw ? "text" : "password"} className="field-input pr-10"
                  value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button"
                  className="field-input-icon absolute right-3 top-1/2 -translate-y-1/2 opacity-60 hover:opacity-90"
                  onClick={() => setShowPw(!showPw)}>
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={handleCancel}
                className="btn-outline flex-1 py-2.5 text-sm font-medium">Cancel</button>
              <button type="submit" disabled={submitting}
                className="btn-primary flex-1 py-2.5 text-sm font-semibold disabled:opacity-50">
                {submitting ? "Signing in…" : "Sign In"}
              </button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}