/**
 * clubsApi.ts - Badminton club lookup.
 */

import { ok, err, delay, API_BASE, publicHeaders, apiFetch } from "./_base";
import type { ApiResult } from "./_base";
import type { BadmintonClub } from "@/types/config";

export async function apiGetBadmintonClubs(): Promise<ApiResult<BadmintonClub[]>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/clubs`, { headers: publicHeaders() });
  if (!res.ok) return err("FETCH_FAILED", "Failed to load badminton clubs.");
  return ok(await res.json());
}
