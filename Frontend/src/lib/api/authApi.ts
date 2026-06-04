/**
 * authApi.ts — Authentication & session management.
 *
 * Real backend: POST /auth/login, POST /auth/logout, GET /auth/me,
 *               POST /auth/change-password
 *
 * Mock: delegates to mockUserStore (in-memory, seeded from config.json).
 * Swap: replace function bodies with fetch() calls to your auth endpoints.
 *
 * Consumers: AuthContext.tsx
 */

import { ok, err, delay, API_BASE, publicHeaders, adminHeaders, parseError, apiFetch } from "./_base";
import type { ApiResult }  from "./_base";
import type { AdminUser }  from "@/types/config";

// ── Response shapes ───────────────────────────────────────────────────────────

export interface LoginResponse {
  user:  AdminUser;
  token: string;   // JWT (mock returns a dummy string; real backend returns signed JWT)
}

// ── API functions ─────────────────────────────────────────────────────────────

/**
 * POST /auth/login
 * Returns the authenticated user + session token.
 */
export async function apiLogin(
  email: string,
  password: string,
): Promise<ApiResult<LoginResponse>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: publicHeaders(),
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) return err("INVALID_CREDENTIALS", "Invalid email or password.");
  return ok(await res.json());
}

/**
 * POST /auth/logout
 * Invalidates the server-side session/token.
 */
export async function apiLogout(): Promise<ApiResult<null>> {
  await delay();

  await apiFetch(`${API_BASE}/api/auth/logout`, { method: "POST", headers: adminHeaders() });
  return ok(null);
}

/**
 * GET /auth/me
 * Re-validates stored token; returns current user or 401.
 * Used on app boot to restore session.
 */
export async function apiGetMe(token: string): Promise<ApiResult<AdminUser>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/auth/me`, {
    headers: adminHeaders(),
  });
  if (!res.ok) return err("UNAUTHORIZED", "Session expired.");
  return ok(await res.json());
}

/**
 * POST /auth/change-password
 * Requires the current password for self-service change.
 */
export async function apiChangePassword(
  currentPassword: string,
  newPassword: string,
): Promise<ApiResult<null>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/auth/change-password`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!res.ok) return err("INVALID_CREDENTIALS", "Current password is incorrect.");
  return ok(null);
}