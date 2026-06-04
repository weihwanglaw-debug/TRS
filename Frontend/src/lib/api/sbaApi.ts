/**
 * sbaApi.ts - SBA rankings, member lookup, and ranking import.
 */

import { ok, err, delay, API_BASE, publicHeaders, getToken, parseError, apiFetch } from "./_base";
import type { ApiResult } from "./_base";
import type { SbaRanking, SbaRankingType } from "@/types/config";

export interface SbaMember {
  sbaId: string;
  name: string;
  dob: string;
  club: string;
  rankingType?: string;
  ranking?: number;
  accumulatedScore?: number;
}

export interface SbaImportResult {
  importedRows: number;
  categories: Array<{ rankingType: string; rows: number }>;
  skippedSheets: string[];
}

export async function apiGetSbaRankings(filters?: {
  type?: string;
}): Promise<ApiResult<SbaRanking[]>> {
  await delay();

  const params = new URLSearchParams();
  if (filters?.type) params.set("type", filters.type);
  const res = await apiFetch(`${API_BASE}/api/sba/rankings?${params}`, { headers: publicHeaders() });
  if (!res.ok) return err("FETCH_FAILED", "Failed to load SBA rankings.");
  return ok(await res.json());
}

export async function apiGetSbaRankingTypes(): Promise<ApiResult<SbaRankingType[]>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/sba/types`, { headers: publicHeaders() });
  if (!res.ok) return err("FETCH_FAILED", "Failed to load SBA ranking types.");
  return ok(await res.json());
}

export async function apiGetSbaMember(sbaId: string, type?: string): Promise<ApiResult<SbaMember>> {
  await delay();

  const normalizedSbaId = sbaId.trim().toUpperCase();
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  const res = await apiFetch(`${API_BASE}/api/sba/members/${encodeURIComponent(normalizedSbaId)}?${params}`, {
    headers: publicHeaders(),
  });
  if (!res.ok) return err("NOT_FOUND", "SBA member not found.");
  return ok(await res.json());
}

export async function apiSearchSbaMembers(name: string, type?: string): Promise<ApiResult<SbaMember[]>> {
  await delay();

  const params = new URLSearchParams({ name });
  if (type) params.set("type", type);
  const res = await apiFetch(`${API_BASE}/api/sba/members?${params}`, { headers: publicHeaders() });
  if (!res.ok) return err("SEARCH_FAILED", "SBA member search failed.");
  return ok(await res.json());
}

export async function apiImportSbaRankings(file: File): Promise<ApiResult<SbaImportResult>> {
  await delay();

  const form = new FormData();
  form.append("file", file);
  const token = getToken();
  const res = await apiFetch(`${API_BASE}/api/sba/import`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) return err("IMPORT_FAILED", (await parseError(res, "Failed to import SBA rankings.")).message);
  return ok(await res.json());
}
