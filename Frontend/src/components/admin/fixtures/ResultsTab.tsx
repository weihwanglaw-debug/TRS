/**
 * ResultsTab.tsx — Completed match results, grouped by round
 *
 * - Shows only matches with results (Completed / Walkover)
 * - Also shows all matches so admin can enter missing scores
 * - Grouped by round for easy reading
 * - Print: Results Sheet
 */

import React, { useState } from "react";
import { Trophy, Printer } from "lucide-react";
import type { BracketState, MatchEntry } from "@/types/config";
import { getAllMatches } from "@/lib/fixtureEngine";

interface Props {
  bracketState: BracketState;
  eventName:    string;
  programName:  string;
  onOpenScore:  (m: MatchEntry) => void;
}

// ── Score display helper ──────────────────────────────────────────────────────

function ScoreStr({ match }: { match: MatchEntry }) {
  if (match.walkover)
    return <span className="font-mono text-xs">W/O</span>;
  const played = match.games.filter(g => g.p1 !== "" && g.p2 !== "");
  if (!played.length)
    return <span className="opacity-30 text-xs">—</span>;
  return (
    <span className="font-mono text-xs">
      {played.map((g, i) => <span key={i}>{i > 0 ? ", " : ""}{g.p1}–{g.p2}</span>)}
    </span>
  );
}

// ── Result row ────────────────────────────────────────────────────────────────

function ResultRow({ match, onOpenScore }: { match: MatchEntry; onOpenScore: (m: MatchEntry) => void }) {
  const isDone    = match.status === "Completed" || match.status === "Walkover";
  const isBye     = match.team1.label === "BYE" || match.team2.label === "BYE"
    || match.team1.id.startsWith("bye-") || match.team2.id.startsWith("bye-");
  const winner    = match.winner === "team1" ? match.team1
                  : match.winner === "team2" ? match.team2
                  : match.walkover && match.walkoverWinner ? (match.walkoverWinner === "team1" ? match.team1 : match.team2)
                  : null;

  return (
    <tr>
      <td><span className="font-mono text-xs opacity-50">{match.id}</span></td>
      <td>
        <div className="flex items-center gap-1.5">
          {match.team1.seed != null && (
            <span className="text-xs font-bold px-1 py-0.5 flex-shrink-0"
              style={{ backgroundColor: "var(--color-primary)", color: "var(--color-hero-text)" }}>
              #{match.team1.seed}
            </span>
          )}
          <div>
            <span className={`font-medium text-sm ${match.winner === "team1" ? "font-bold" : ""}`}
              style={{ color: match.winner === "team1" ? "var(--color-primary)" : undefined }}>
              {match.team1.label}
            </span>
            {match.winner === "team1" && <Trophy className="h-3.5 w-3.5 inline ml-1" style={{ color: "var(--color-primary)" }} />}
            <div className="text-xs opacity-50">{match.team1.participants.join(" / ")}</div>
          </div>
        </div>
      </td>
      <td className="text-center">
        <ScoreStr match={match} />
      </td>
      <td>
        <div className="flex items-center gap-1.5 justify-end">
          <div className="text-right">
            <span className={`font-medium text-sm ${match.winner === "team2" ? "font-bold" : ""}`}
              style={{ color: match.winner === "team2" ? "var(--color-primary)" : undefined }}>
              {match.team2.label}
            </span>
            {match.winner === "team2" && <Trophy className="h-3.5 w-3.5 inline ml-1" style={{ color: "var(--color-primary)" }} />}
            <div className="text-xs opacity-50">{match.team2.participants.join(" / ")}</div>
          </div>
          {match.team2.seed != null && (
            <span className="text-xs font-bold px-1 py-0.5 flex-shrink-0"
              style={{ backgroundColor: "var(--color-primary)", color: "var(--color-hero-text)" }}>
              #{match.team2.seed}
            </span>
          )}
        </div>
      </td>
      <td>
        {isDone ? (
          <span className="text-xs font-semibold px-2 py-1"
            style={{ backgroundColor: "var(--badge-open-bg)", color: "var(--badge-open-text)" }}>
            {match.walkover ? "Walkover" : "Completed"}
          </span>
        ) : (
          <span className="text-xs font-semibold px-2 py-1"
            style={{ backgroundColor: "var(--badge-closed-bg)", color: "var(--badge-closed-text)" }}>
            {match.status}
          </span>
        )}
      </td>
      <td className="text-xs opacity-50 whitespace-nowrap">
        {match.courtNo && <span>{match.courtNo} · </span>}
        {match.matchDate && <span>{new Date(match.matchDate).toLocaleDateString("en-SG", { day: "2-digit", month: "short" })}</span>}
        {match.startTime && <span> {match.startTime}</span>}
      </td>
      <td>
        <button
          onClick={() => onOpenScore(match)}
          disabled={isBye}
          title={isBye ? "BYE match has no score to enter." : undefined}
          className="btn-primary px-3 py-1.5 text-xs font-semibold whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed">
          {isBye ? "BYE" : (isDone ? "Edit" : "Enter Score")}
        </button>
      </td>
    </tr>
  );
}

// ── Round group ───────────────────────────────────────────────────────────────

function RoundGroup({ label, matches, onOpenScore }: {
  label: string; matches: MatchEntry[]; onOpenScore: (m: MatchEntry) => void;
}) {
  const done = matches.filter(m => m.status === "Completed" || m.status === "Walkover").length;
  const allDone = done === matches.length;

  return (
    <div className="mb-6" style={{ border: "1px solid var(--color-table-border)" }}>
      <div className="flex items-center justify-between px-4 py-3"
        style={{ backgroundColor: "var(--color-row-hover)", borderBottom: "1px solid var(--color-table-border)" }}>
        <span className="font-bold text-sm">{label}</span>
        <span className="text-xs font-semibold px-2 py-0.5"
          style={{
            backgroundColor: allDone ? "var(--badge-open-bg)" : "var(--badge-soon-bg)",
            color:           allDone ? "var(--badge-open-text)" : "var(--badge-soon-text)",
          }}>
          {done} / {matches.length} completed
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="trs-table">
          <thead>
            <tr>
              <th style={{ width: 80 }}>Match</th>
              <th>Team 1</th>
              <th className="text-center" style={{ width: 120 }}>Score</th>
              <th className="text-right">Team 2</th>
              <th style={{ width: 100 }}>Status</th>
              <th style={{ width: 140 }}>Venue / Time</th>
              <th style={{ width: 90 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {matches.map(m => <ResultRow key={m.id} match={m} onOpenScore={onOpenScore} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Print results sheet ───────────────────────────────────────────────────────

function PrintResults({ eventName, programName, matches }: {
  eventName: string; programName: string; matches: MatchEntry[];
}) {
  const done = matches.filter(m => m.status === "Completed" || m.status === "Walkover");

  // Group by roundLabel
  const groups = new Map<string, MatchEntry[]>();
  for (const m of done) {
    const k = m.groupId ? `Group ${m.groupId}` : (m.roundLabel || "Round 1");
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(m);
  }

  return (
    <div className="hidden print:block results-print-only">
      <div className="mb-6 border-b pb-4">
        <h1 className="text-2xl font-bold">{eventName}</h1>
        <h2 className="text-lg">{programName} — Results</h2>
        <p className="text-sm opacity-60">Printed: {new Date().toLocaleString("en-SG")}</p>
      </div>
      {[...groups.entries()].map(([label, grpMatches]) => (
        <div key={label} className="mb-6">
          <h3 style={{ fontWeight: 700, marginBottom: 6, borderBottom: "2px solid #1E3A5F", paddingBottom: 4 }}>{label}</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ backgroundColor: "#1E3A5F", color: "white" }}>
                {["Match", "Team 1", "Score", "Team 2", "Winner", "Court", "Date"].map(h => (
                  <th key={h} style={{ padding: "5px 8px", textAlign: "left" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grpMatches.map((m, i) => {
                const winnerLabel = m.winner === "team1" ? m.team1.label
                  : m.winner === "team2" ? m.team2.label
                  : m.walkover && m.walkoverWinner ? (m.walkoverWinner === "team1" ? m.team1.label : m.team2.label)
                  : "Draw";
                const scoreStr = m.walkover ? "W/O"
                  : m.games.filter(g => g.p1 !== "").map(g => `${g.p1}–${g.p2}`).join(", ") || "—";
                return (
                  <tr key={m.id} style={{ backgroundColor: i % 2 === 0 ? "white" : "#F3F4F6" }}>
                    <td style={{ padding: "5px 8px", fontFamily: "monospace", fontSize: 10 }}>{m.id}</td>
                    <td style={{ padding: "5px 8px", fontWeight: m.winner === "team1" ? 700 : 400 }}>{m.team1.label}</td>
                    <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{scoreStr}</td>
                    <td style={{ padding: "5px 8px", fontWeight: m.winner === "team2" ? 700 : 400 }}>{m.team2.label}</td>
                    <td style={{ padding: "5px 8px", fontWeight: 700, color: "#1E3A5F" }}>{winnerLabel}</td>
                    <td style={{ padding: "5px 8px" }}>{m.courtNo || "—"}</td>
                    <td style={{ padding: "5px 8px" }}>
                      {m.matchDate ? new Date(m.matchDate).toLocaleDateString("en-SG", { day: "2-digit", month: "short" }) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function ResultsTab({ bracketState, eventName, programName, onOpenScore }: Props) {
  const [showAll, setShowAll] = useState(false);

  const all      = getAllMatches(bracketState);
  const done     = all.filter(m => m.status === "Completed" || m.status === "Walkover");
  const display  = showAll ? all : all; // always show all so admin can enter scores

  // Group by label
  const grouped = React.useMemo(() => {
    const map = new Map<string, MatchEntry[]>();
    for (const m of display) {
      const k = m.groupId ? `Group ${m.groupId}` : (m.roundLabel || "Round 1");
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(m);
    }
    return map;
  }, [display]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5 print:hidden">
        <div>
          <span className="text-sm font-semibold">{done.length}</span>
          <span className="text-sm opacity-60"> of {all.length} matches completed</span>
        </div>
        <button onClick={() => window.print()}
          className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm font-medium">
          <Printer className="h-4 w-4" /> Print Results
        </button>
      </div>

      {all.length === 0 ? (
        <p className="text-center py-12 text-sm opacity-40">No matches generated yet.</p>
      ) : (
        [...grouped.entries()].map(([label, matches]) => (
          <RoundGroup key={label} label={label} matches={matches} onOpenScore={onOpenScore} />
        ))
      )}

      <PrintResults eventName={eventName} programName={programName} matches={all} />
    </div>
  );
}
