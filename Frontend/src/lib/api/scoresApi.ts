import { API_BASE, apiFetch, parseError } from "./_base";

export type ScoreEntry = { id: string; name: string; players: string[]; seed: number | null };
export type ScoreMatch = {
  id: string; programId: number; programName: string; phase: string; round: number; roundLabel: string; group: string;
  team1: ScoreEntry; team2: ScoreEntry; games: { a: number; b: number }[]; winner: "A" | "B" | null;
  outcome: string; remark: string; matchDate: string; startTime: string; endTime: string; court: string;
  gamePhase?: string | null; phaseUntil?: string | null; gameNumber?: number | null;
  status: string; scoreA: number | null; scoreB: number | null; serverSide: "A" | "B" | null;
};
export type LiveScores = { eventId: number; eventName: string; receivedAt: string | null; refreshSeconds: number; timeZone: string; matches: ScoreMatch[] };
export type ProgramResults = {
  eventId: number; eventName: string; programs: { id: number; name: string }[]; programId: number | null;
  source: string; receivedAt: string | null; timeZone: string; matches: ScoreMatch[];
  heats: { programId?: number; label: string; roundNumber: number; results: { name: string; result: string; place: number | null; advanced: boolean }[] }[];
};

async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await apiFetch(`${API_BASE}/api/events/${path}`, { method: "GET", cache: "no-store", signal });
  if (!response.ok) throw new Error((await parseError(response, "Unable to load scores.")).message);
  return response.json();
}
export const getLiveScores = (id: string, signal?: AbortSignal) => read<LiveScores>(`${id}/live`, signal);
export const getProgramResults = (id: string, program: string, signal?: AbortSignal) => read<ProgramResults>(`${id}/results${program ? `?programId=${encodeURIComponent(program)}` : ""}`, signal);
export const getLiveStatus = (signal?: AbortSignal) => read<{ eventId: number; receivedAt: string }[]>("live-status", signal);
export type ScoreAvailability = { hasLiveScores: boolean; hasResults: boolean; resultProgramIds: number[]; refreshSeconds: number };
export const getScoreAvailability = (id: string, signal?: AbortSignal) => read<ScoreAvailability>(`${id}/score-availability`, signal);
