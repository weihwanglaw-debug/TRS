/**
 * fixtureApi.ts — Real API. All state lives in the backend Fixtures table.
 * The fixture engine (fixtureEngine.ts) is still used locally to compute
 * new states — the backend stores and serves the JSON blob, not the logic.
 */

import type { SeedEntry, BracketState, MatchEntry, FixtureFormatConfig } from "@/types/config";
import { API_BASE, adminHeaders, parseError, apiFetch } from "@/lib/api/_base";

// ── Result types ──────────────────────────────────────────────────────────────
export interface ApiError { code: string; message: string }
export type ApiResult<T> = { data: T; error: null } | { data: null; error: ApiError }

function ok<T>(data: T): ApiResult<T>                     { return { data, error: null }; }
function err(code: string, msg: string): ApiResult<never>  { return { data: null, error: { code, message: msg } }; }

// ── Shared save helper — persists any BracketState to the backend ─────────────
async function persist(
  eventId: string, programId: string,
  state: BracketState,
): Promise<ApiResult<BracketState>> {
  const res = await apiFetch(`${API_BASE}/api/fixtures/${eventId}/${programId}`, {
    method:  "POST",
    headers: adminHeaders(),
    body:    JSON.stringify({
      bracketStateJson: JSON.stringify(state),
      fixtureFormat:    state.format,
      phase:            state.phase,
      isLocked:         state.locked,
    }),
  });
  if (!res.ok) return err("SAVE_FAILED", (await parseError(res)).message);
  return ok(state);
}

// ── GET /api/fixtures/status  ─────────────────────────────────────────────────
// Returns { [programId]: boolean } — true means a fixture row exists in the DB.
// Used by the Fixtures table and Dashboard to show Draw status without fetching full brackets.
export async function apiGetFixtureStatus(
  programIds: string[],
): Promise<ApiResult<Record<string, boolean>>> {
  if (!programIds.length) return ok({});
  const res = await apiFetch(
    `${API_BASE}/api/fixtures/status?programIds=${programIds.join(",")}`,
    { headers: adminHeaders() },
  );
  if (!res.ok) return err("FETCH_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}

// ── GET /api/fixtures/:eventId/:programId ─────────────────────────────────────
export async function apiGetFixture(
  eventId: string,
  programId: string,
): Promise<ApiResult<BracketState | null>> {
  const res = await apiFetch(`${API_BASE}/api/fixtures/${eventId}/${programId}`, {
    headers: adminHeaders(),
  });
  if (res.status === 404) return ok(null);
  if (!res.ok) return err("FETCH_FAILED", (await parseError(res)).message);
  // .NET Ok(null) returns an empty body (not "null" JSON) — guard against that
  const text = await res.text();
  if (!text || text.trim() === "" || text.trim() === "null") return ok(null);
  let data: any;
  try { data = JSON.parse(text); } catch { return ok(null); }
  if (!data?.bracketStateJson) return ok(null);
  try {
    return ok(JSON.parse(data.bracketStateJson) as BracketState);
  } catch {
    return err("PARSE_FAILED", "Fixture data is corrupted.");
  }
}

// ── POST /api/fixtures/generate ───────────────────────────────────────────────
export async function apiGenerateDraw(
  eventId: string, programId: string,
  seeds: SeedEntry[], config: FixtureFormatConfig,
  prebuiltBracket?: BracketState,
): Promise<ApiResult<BracketState>> {
  if (seeds.length < 2) return err("NOT_ENOUGH", "At least 2 participants required.");
  const seedNums = seeds.map(s => s.seed).filter((s): s is number => s !== null);
  if (seedNums.length !== new Set(seedNums).size)
    return err("DUPLICATE_SEEDS", "Duplicate seed numbers — each must be unique.");
  const res = await apiFetch(`${API_BASE}/api/fixtures/${eventId}/${programId}/generate`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      seeds,
      config,
      previewBracketJson: prebuiltBracket ? JSON.stringify(prebuiltBracket) : null,
    }),
  });
  if (!res.ok) return err("GENERATE_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}

// ── DELETE /api/fixtures/:eventId/:programId ──────────────────────────────────
export async function apiResetFixture(
  eventId: string,
  programId: string,
): Promise<ApiResult<null>> {
  const res = await apiFetch(`${API_BASE}/api/fixtures/${eventId}/${programId}`, {
    method:  "DELETE",
    headers: adminHeaders(),
  });
  if (!res.ok) return err("DELETE_FAILED", (await parseError(res)).message);
  return ok(null);
}

// ── PATCH score ───────────────────────────────────────────────────────────────
export async function apiSaveScore(
  eventId: string, programId: string, matchId: string,
  updates: Partial<Pick<MatchEntry, "games" | "winner" | "walkover" | "walkoverWinner" | "officials">>,
): Promise<ApiResult<BracketState>> {
  const res = await apiFetch(`${API_BASE}/api/fixtures/${eventId}/${programId}/score/${matchId}`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({
      games: updates.games ?? [],
      winner: updates.winner ?? null,
      walkover: updates.walkover ?? false,
      walkoverWinner: updates.walkoverWinner ?? "",
      officials: updates.officials ?? [],
    }),
  });
  if (!res.ok) return err("SAVE_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}

// ── PATCH schedule ────────────────────────────────────────────────────────────
export async function apiUpdateSchedule(
  eventId: string, programId: string, matchId: string,
  s: { courtNo: string; matchDate: string; startTime: string; endTime: string },
): Promise<ApiResult<BracketState>> {
  const res = await apiFetch(`${API_BASE}/api/fixtures/${eventId}/${programId}/schedule/${matchId}`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify(s),
  });
  if (!res.ok) return err("SAVE_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}

// ── POST advance to knockout ──────────────────────────────────────────────────
export async function apiAdvanceToKnockout(
  eventId: string,
  programId: string,
): Promise<ApiResult<BracketState>> {
  const res = await apiFetch(`${API_BASE}/api/fixtures/${eventId}/${programId}/advance-to-knockout`, {
    method: "POST",
    headers: adminHeaders(),
  });
  if (!res.ok) return err("ADVANCE_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}

// ── POST next knockout round ──────────────────────────────────────────────────
export async function apiAdvanceKnockoutRound(
  eventId: string,
  programId: string,
): Promise<ApiResult<BracketState>> {
  const res = await apiFetch(`${API_BASE}/api/fixtures/${eventId}/${programId}/advance-round`, {
    method: "POST",
    headers: adminHeaders(),
  });
  if (!res.ok) return err("ADVANCE_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}

// ── POST swap teams ───────────────────────────────────────────────────────────
export async function apiSwapTeams(
  eventId: string, programId: string,
  idA: string, idB: string,
): Promise<ApiResult<BracketState>> {
  const res = await apiFetch(`${API_BASE}/api/fixtures/${eventId}/${programId}/swap`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ idA, idB }),
  });
  if (!res.ok) return err("SWAP_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}

// ── Heats ─────────────────────────────────────────────────────────────────────
export async function apiSaveHeatResult(
  eventId: string, programId: string,
  roundNumber: number, teamId: string, result: string,
): Promise<ApiResult<BracketState>> {
  const res = await apiFetch(`${API_BASE}/api/fixtures/${eventId}/${programId}/heats/result`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({ roundNumber, teamId, result }),
  });
  if (!res.ok) return err("SAVE_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}

export async function apiAdvanceHeatsRound(
  eventId: string, programId: string,
  fromRound: number, advancingIds: string[],
): Promise<ApiResult<BracketState>> {
  const res = await apiFetch(`${API_BASE}/api/fixtures/${eventId}/${programId}/heats/advance`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ fromRound, advancingIds }),
  });
  if (!res.ok) return err("ADVANCE_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}

export async function apiAssignHeatPlaces(
  eventId: string, programId: string,
  places: Record<string, number>,
): Promise<ApiResult<BracketState>> {
  const res = await apiFetch(`${API_BASE}/api/fixtures/${eventId}/${programId}/heats/places`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ places }),
  });
  if (!res.ok) return err("SAVE_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}