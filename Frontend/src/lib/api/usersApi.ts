/**
 * usersApi.ts — Admin user management (CRUD).
 *
 * Real backend: GET/POST /admin/users, PUT/DELETE /admin/users/:id,
 *               POST /admin/users/:id/reset-password
 *
 * Mock: delegates to mockUserStore (same in-memory store as AuthContext).
 * Swap: replace function bodies with fetch() calls.
 *
 * Consumers: Usermanagement.tsx, AuthContext.tsx (read only)
 */

import { ok, err, delay, API_BASE, adminHeaders, parseError, apiFetch } from "./_base";
import type { ApiResult }  from "./_base";
import type { AdminUser }  from "@/types/config";

// ── API functions ─────────────────────────────────────────────────────────────

/**
 * GET /admin/users
 * Returns all admin users. Passwords are stripped server-side in real API.
 */
export async function apiGetUsers(): Promise<ApiResult<AdminUser[]>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/admin/users`, { headers: adminHeaders() });
  if (!res.ok) return err("FETCH_FAILED", "Failed to load users.");
  return ok(await res.json());
}

/**
 * POST /admin/users
 * Creates a new admin user. Password is hashed server-side.
 */
export async function apiCreateUser(
  payload: Omit<AdminUser, "id" | "lastLogin">,
): Promise<ApiResult<AdminUser>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/admin/users`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) return err("CREATE_FAILED", "Failed to create user.");
  return ok(await res.json());
}

/**
 * PUT /admin/users/:id
 * Updates name, email, and/or role. Does NOT update password (use resetPassword).
 */
export async function apiUpdateUser(
  id: string,
  patch: Partial<Pick<AdminUser, "name" | "email" | "role">>,
): Promise<ApiResult<AdminUser>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/admin/users/${id}`, {
    method: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) return err("UPDATE_FAILED", "Failed to update user.");
  return ok(await res.json());
}

/**
 * DELETE /admin/users/:id
 * Permanently removes an admin user. Cannot delete your own account.
 */
export async function apiDeleteUser(
  id: string,
  currentUserId: string,
): Promise<ApiResult<null>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/admin/users/${id}`, { method: "DELETE", headers: adminHeaders() });
  if (!res.ok) return err("DELETE_FAILED", "Failed to delete user.");
  return ok(null);
}

/**
 * POST /admin/users/:id/reset-password
 * Admin-initiated reset; does not require the old password.
 */
export async function apiResetUserPassword(
  id: string,
  newPassword: string,
): Promise<ApiResult<null>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/admin/users/${id}/reset-password`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ newPassword }),
  });
  if (!res.ok) return err("RESET_FAILED", "Failed to reset password.");
  return ok(null);
}