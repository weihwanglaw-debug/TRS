/**
 * fixtureStatus.ts
 *
 * Pure computation helpers — NO localStorage.
 * All bracket data now comes from the real backend via fixtureApi.ts.
 *
 * Two layers:
 *   1. computeProgramFixtureStatus()  — pure: given a BracketState (or null) + context,
 *      returns the status. Called after apiGetFixture() resolves.
 *
 *   2. computeFixtureDashboardStats() — pure: given events + a fixture-exists map
 *      (from apiGetFixtureStatus()), returns dashboard counts without fetching brackets.
 */

import type { TournamentEvent, BracketState } from "@/types/config";
import { getAllMatches } from "@/lib/fixtureEngine";

// ── Per-program status ────────────────────────────────────────────────────────

export type ProgramFixtureStatus =
  | "reg_open"      // registration still open
  | "ready"         // reg closed, no fixture yet
  | "draft"         // fixture generated, no scores yet
  | "in_progress"   // some matches completed
  | "complete"      // all matches done
  | "not_required"; // fixtureMode = not_required

export interface ProgramFixtureInfo {
  programId:      string;
  programName:    string;
  status:         ProgramFixtureStatus;
  totalMatches:   number;
  doneMatches:    number;
  pendingPastDue: number;
  bracket:        BracketState | null;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Compute fixture status from an already-fetched BracketState (or null).
 * Call this after apiGetFixture() resolves — never reads localStorage.
 */
export function computeProgramFixtureStatus(
  program:     { id: string; name: string },
  closeDate:   string,
  fixtureMode: string | undefined,
  bracket:     BracketState | null,
): ProgramFixtureInfo {
  if (fixtureMode === "not_required") {
    return {
      programId: program.id, programName: program.name,
      status: "not_required", totalMatches: 0, doneMatches: 0, pendingPastDue: 0, bracket: null,
    };
  }

  const regClosed = new Date() > new Date(closeDate);

  if (!regClosed) {
    return {
      programId: program.id, programName: program.name,
      status: "reg_open", totalMatches: 0, doneMatches: 0, pendingPastDue: 0, bracket: null,
    };
  }

  if (!bracket) {
    return {
      programId: program.id, programName: program.name,
      status: "ready", totalMatches: 0, doneMatches: 0, pendingPastDue: 0, bracket: null,
    };
  }

  // Heats format
  if (bracket.format === "heats") {
    const rounds     = bracket.heatRounds ?? [];
    const complete   = rounds.every(r => r.isComplete);
    const anyStarted = rounds.some(r => r.isComplete);
    return {
      programId: program.id, programName: program.name,
      status: complete ? "complete" : anyStarted ? "in_progress" : "draft",
      totalMatches: rounds.length,
      doneMatches: rounds.filter(r => r.isComplete).length,
      pendingPastDue: 0, bracket,
    };
  }

  const today   = todayStr();
  const matches = getAllMatches(bracket);
  const total   = matches.length;
  const done    = matches.filter(m => m.status === "Completed" || m.status === "Walkover").length;
  const pastDue = matches.filter(m =>
    m.matchDate && m.matchDate <= today &&
    m.status !== "Completed" && m.status !== "Walkover"
  ).length;

  if (total === 0 || done === 0) {
    return {
      programId: program.id, programName: program.name,
      status: "draft", totalMatches: total, doneMatches: 0, pendingPastDue: pastDue, bracket,
    };
  }
  if (done === total) {
    return {
      programId: program.id, programName: program.name,
      status: "complete", totalMatches: total, doneMatches: done, pendingPastDue: 0, bracket,
    };
  }
  return {
    programId: program.id, programName: program.name,
    status: "in_progress", totalMatches: total, doneMatches: done, pendingPastDue: pastDue, bracket,
  };
}

// ── Dashboard stats ───────────────────────────────────────────────────────────
// fixtureExists: programId -> boolean, from apiGetFixtureStatus()

export interface FixtureDashboardStats {
  pendingPayments: number;
  pendingFixture:  number;   // reg closed + no fixture yet
  pendingResults:  number;   // fixture exists, reg closed (needs attention)
}

export function computeFixtureDashboardStats(
  events:        TournamentEvent[],
  fixtureExists: Record<string, boolean>,
): FixtureDashboardStats {
  let pendingFixture = 0;
  let pendingResults = 0;
  const today = todayStr();

  for (const ev of events) {
    if (!ev.isSports) continue;
    if (ev.fixtureMode === "not_required" || ev.fixtureMode === "external") continue;
    const regClosed = today > ev.closeDate;
    if (!regClosed) continue;

    for (const p of ev.programs) {
      if (fixtureExists[p.id]) {
        pendingResults++;
      } else {
        pendingFixture++;
      }
    }
  }

  return { pendingPayments: 0, pendingFixture, pendingResults };
}