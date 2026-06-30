/**
 * clubsApi.ts - Badminton club lookup.
 */

import { ok, err, delay, API_BASE, publicHeaders, adminHeaders, parseError, apiFetch } from "./_base";
import type { ApiResult } from "./_base";
import type { BadmintonClub, BadmintonClubInput } from "@/types/config";

export async function apiGetBadmintonClubs(search?: string): Promise<ApiResult<BadmintonClub[]>> {
  await delay();

  const params = new URLSearchParams();
  if (search?.trim()) params.set("search", search.trim());
  const suffix = params.toString() ? `?${params}` : "";
  const res = await apiFetch(`${API_BASE}/api/clubs${suffix}`, { headers: publicHeaders() });
  if (!res.ok) return err("FETCH_FAILED", "Failed to load badminton clubs.");
  return ok(await res.json());
}

export async function apiCreateBadmintonClub(payload: BadmintonClubInput): Promise<ApiResult<BadmintonClub>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/clubs`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) return err("CREATE_FAILED", (await parseError(res, "Failed to create badminton club.")).message);
  return ok(await res.json());
}

export async function apiUpdateBadmintonClub(id: number, payload: BadmintonClubInput): Promise<ApiResult<BadmintonClub>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/clubs/${id}`, {
    method: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) return err("UPDATE_FAILED", (await parseError(res, "Failed to update badminton club.")).message);
  return ok(await res.json());
}

export async function apiDeleteBadmintonClub(id: number): Promise<ApiResult<true>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/clubs/${id}`, {
    method: "DELETE",
    headers: adminHeaders(),
  });
  if (!res.ok) return err("DELETE_FAILED", (await parseError(res, "Failed to delete badminton club.")).message);
  return ok(true);
}
