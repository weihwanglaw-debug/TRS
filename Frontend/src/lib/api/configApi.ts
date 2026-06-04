/**
 * configApi.ts — System-wide master configuration.
 *
 * Real backend: GET /config, PUT /config
 *
 * The config stores branding, hero copy, footer, payment currency, and
 * the global consent statement. It is shared across all events.
 *
 * Mock: reads from config.json; writes go to LiveConfigContext (in-memory).
 *       In production, PUT /api/config persists to the database config table.
 *
 * Consumers: LiveConfigContext.tsx, Masterconfig.tsx
 */

import { ok, err, delay, API_BASE, publicHeaders, adminHeaders, apiFetch } from "./_base";
import type { ApiResult } from "./_base";
import type { LiveConfig } from "@/contexts/LiveConfigContext";

// ── API functions ─────────────────────────────────────────────────────────────

/**
 * GET /config
 * Returns the current system configuration.
 */
export async function apiGetConfig(): Promise<ApiResult<LiveConfig>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/config`, { headers: publicHeaders() });
  if (!res.ok) return err("FETCH_FAILED", "Failed to load configuration.");
  return ok(await res.json());
}

/**
 * PUT /config
 * Saves one or more config fields. Partial updates are supported.
 * Returns the complete updated config.
 */
export async function apiUpdateConfig(
  patch: Partial<LiveConfig>,
): Promise<ApiResult<LiveConfig>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/config`, {
    method: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify({ updates: patch }),  // ← wrapped to match backend UpdateConfigRequest
  });
  if (!res.ok) return err("UPDATE_FAILED", "Failed to save configuration.");
  return ok(await res.json());
}