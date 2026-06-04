/**
 * AuthContext.tsx
 *
 * Mock:  delegates to mockUserStore (login) + localStorage (session)
 * Real:  swap the three commented fetch() blocks:
 *          apiLogin()          → POST /auth/login
 *          apiGetMe(token)     → GET  /auth/me   (session restore on boot)
 *          apiLogout()         → POST /auth/logout
 *
 * mustChangePassword is enforced here — any component that needs the flag
 * can read it from user?.mustChangePassword.
 *
 * Token storage: localStorage("trs_token") for Bearer auth.
 * Remove mock: delete mockUserStore import + mock blocks.
 */

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { PageLoader } from "@/components/ui/LoadingSpinner";
import type { AdminUser } from "@/types/config";
import { apiLogin, apiLogout, apiGetMe } from "@/lib/api";

const TOKEN_KEY = "trs_token";
const USER_KEY  = "trs_user";

interface AuthState {
  isAuthenticated:    boolean;
  user:               AdminUser | null;
  mustChangePassword: boolean;
  login:   (email: string, password: string) => Promise<string | null>;
  logout:  () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  isAuthenticated:    false,
  user:               null,
  mustChangePassword: false,
  login:   async () => "Not initialised",
  logout:  async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user,  setUser]  = useState<AdminUser | null>(null);
  const [ready, setReady] = useState(false);   // prevents flash of unauthenticated state

  // ── Session restore on boot ────────────────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) { setReady(true); return; }

    // Validate token against backend on every page load.
    // If the token is expired or invalid, wipe it and show the login page.
    apiGetMe(token).then(r => {
      if (r.data) setUser(r.data);
      else { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }
    }).finally(() => setReady(true));
  }, []);

  // ── Login ──────────────────────────────────────────────────────────────────
  const login = async (email: string, password: string): Promise<string | null> => {
    const r = await apiLogin(email, password);
    if (r.error) return r.error.message;

    const { user: loggedIn, token } = r.data!;
    setUser(loggedIn);
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(loggedIn));
    return null;
  };

  // ── Logout ─────────────────────────────────────────────────────────────────
  const logout = async () => {
    await apiLogout();            // no-op in mock; invalidates session in real backend
    setUser(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  };

  const mustChangePassword = !!(user?.mustChangePassword);

  if (!ready) return <PageLoader label="Authenticating…" />;

  return (
    <AuthContext.Provider value={{ isAuthenticated: !!user, user, mustChangePassword, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};