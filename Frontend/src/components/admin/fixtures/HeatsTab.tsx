/**
 * HeatsTab.tsx — Individual results management for Heats format
 *
 * Shows each round as a card. Admin enters free-text result per participant,
 * then selects who advances. Final round: assigns places (1st, 2nd, 3rd...).
 */

import React, { useEffect, useState } from "react";
import { CheckCircle, ChevronDown, ChevronUp } from "lucide-react";
import type { BracketState, HeatRound } from "@/types/config";

interface Props {
  bracketState:    BracketState;
  eventName:       string;
  programName:     string;
  onSaveResult:    (roundNumber: number, teamId: string, result: string) => Promise<void>;
  onAdvanceRound:  (fromRound: number, advancingIds: string[]) => Promise<void>;
  onAssignPlaces:  (places: Record<string, number>) => Promise<void>;
}

export function HeatsTab({ bracketState, eventName, programName, onSaveResult, onAdvanceRound, onAssignPlaces }: Props) {
  const hc      = bracketState.config.heatsConfig;
  const rounds  = bracketState.heatRounds ?? [];
  const seeds   = bracketState.seeds;
  const resultLabel = hc?.resultLabel ?? "Result";
  const placesAwarded = hc?.placesAwarded ?? 3;
  const advanceCount  = hc?.advancePerRound ?? 4;

  const getTeamLabel = (teamId: string) => seeds.find(s => s.id === teamId)?.club ?? teamId;
  const getPlayers   = (teamId: string) => seeds.find(s => s.id === teamId)?.participants.join(" / ") ?? "";

  // ── Round card ────────────────────────────────────────────────────────────

  function RoundCard({ round }: { round: HeatRound }) {
    const isFinal   = round.isFinal;
    const isActive  = !round.isComplete && (round.roundNumber === 1 || rounds[round.roundNumber - 2]?.isComplete);
    const [editing, setEditing] = useState<Record<string, string>>(() =>
      Object.fromEntries(round.results.map(r => [r.teamId, r.result]))
    );
    const [advancing, setAdvancing] = useState<Set<string>>(new Set(round.results.filter(r => r.advanced).map(r => r.teamId)));
    const [places, setPlaces]       = useState<Record<string, number>>(
      Object.fromEntries(round.results.filter(r => r.place != null).map(r => [r.teamId, r.place!]))
    );
    const [saving, setSaving] = useState(false);
    const [open, setOpen]     = useState(isActive || round.isComplete);
    const [error, setError]   = useState<string | null>(null);

    // If the backend state changes (another admin, or after saves), resync editing values.
    useEffect(() => {
      setEditing(Object.fromEntries(round.results.map(r => [r.teamId, r.result])));
      setAdvancing(new Set(round.results.filter(r => r.advanced).map(r => r.teamId)));
      setPlaces(Object.fromEntries(round.results.filter(r => r.place != null).map(r => [r.teamId, r.place!])));
    }, [round.roundNumber, round.results]);

    const toggleAdvance = (id: string) => {
      const s = new Set(advancing);
      if (s.has(id)) s.delete(id); else if (s.size < advanceCount) s.add(id);
      setAdvancing(s);
    };

    const handleSaveResults = async () => {
      setSaving(true);
      setError(null);
      for (const [teamId, result] of Object.entries(editing)) {
        try {
          await onSaveResult(round.roundNumber, teamId, result);
        } catch {
          setError("Save stopped due to an error. Some results may have been saved; refresh to confirm.");
          break;
        }
      }
      setSaving(false);
    };

    const handleAdvance = async () => {
      setSaving(true);
      await onAdvanceRound(round.roundNumber, [...advancing]);
      setSaving(false);
    };

    const handleAssignPlaces = async () => {
      setSaving(true);
      await onAssignPlaces(places);
      setSaving(false);
    };

    const allResultsEntered = round.results.every(r => editing[r.teamId]?.trim());
    const canAdvance        = advancing.size === advanceCount || advancing.size === round.results.length;

    return (
      <div style={{ border: `2px solid ${isActive ? "var(--color-primary)" : round.isComplete ? "var(--color-table-border)" : "var(--color-table-border)"}`, opacity: !isActive && !round.isComplete ? 0.4 : 1 }}>
        {/* Header */}
        <button className="w-full flex items-center justify-between px-5 py-4"
          style={{ backgroundColor: round.isComplete ? "var(--color-row-hover)" : isActive ? "var(--color-row-hover)" : "transparent" }}
          onClick={() => setOpen(!open)}>
          <div className="flex items-center gap-3">
            {round.isComplete
              ? <CheckCircle className="h-5 w-5 flex-shrink-0" style={{ color: "var(--badge-open-text)" }} />
              : <div className="w-5 h-5 rounded-full border-2 flex-shrink-0"
                  style={{ borderColor: isActive ? "var(--color-primary)" : "var(--color-table-border)" }} />}
            <div className="text-left">
              <p className="font-bold text-sm">
                {round.label}
                {round.isComplete && <span className="ml-2 text-xs font-normal opacity-50">Complete</span>}
              </p>
              {isActive && !round.isComplete && (
                <p className="text-xs" style={{ color: "var(--color-primary)" }}>Active — enter results</p>
              )}
              {!isActive && !round.isComplete && (
                <p className="text-xs opacity-40">Waiting for previous round</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs opacity-40">{round.results.length} participants</span>
            {open ? <ChevronUp className="h-4 w-4 opacity-40" /> : <ChevronDown className="h-4 w-4 opacity-40" />}
          </div>
        </button>

        {open && (
          <div className="border-t" style={{ borderColor: "var(--color-table-border)" }}>
            {error && (
              <div className="px-5 pt-4">
                <div
                  className="text-xs font-semibold px-3 py-2"
                  style={{
                    border: "1px solid var(--badge-closed-text)",
                    color: "var(--badge-closed-text)",
                    backgroundColor: "var(--badge-closed-bg)",
                  }}
                >
                  {error}
                </div>
              </div>
            )}
            <div className="overflow-auto">
              <table className="trs-table">
                <thead>
                  <tr>
                    <th>Club / School</th>
                    <th>Player(s)</th>
                    <th>{resultLabel}</th>
                    {!round.isComplete && !isFinal && (
                      <th className="text-center">Advance?</th>
                    )}
                    {round.isComplete && !isFinal && (
                      <th>Status</th>
                    )}
                    {isFinal && <th style={{ width: 140 }}>Place</th>}
                  </tr>
                </thead>
                <tbody>
                  {round.results.map(res => (
                    <tr key={res.teamId}
                      style={round.isComplete && res.advanced ? { backgroundColor: "var(--badge-open-bg)" } : undefined}>
                      <td className="font-medium text-sm">{getTeamLabel(res.teamId)}</td>
                      <td className="text-xs opacity-60">{getPlayers(res.teamId)}</td>
                      <td>
                        {round.isComplete
                          ? <span className="font-mono text-sm">{res.result || <span className="opacity-30">—</span>}</span>
                          : <input type="text" className="field-input py-1 text-sm w-full"
                              placeholder={`Enter ${resultLabel.toLowerCase()}…`}
                              value={editing[res.teamId] ?? ""}
                              onChange={e => setEditing({ ...editing, [res.teamId]: e.target.value })} />}
                      </td>
                      {!round.isComplete && !isFinal && (
                        <td className="text-center">
                          <input type="checkbox"
                            checked={advancing.has(res.teamId)}
                            onChange={() => toggleAdvance(res.teamId)}
                            disabled={!advancing.has(res.teamId) && advancing.size >= advanceCount}
                            className="w-4 h-4 cursor-pointer" />
                        </td>
                      )}
                      {round.isComplete && !isFinal && (
                        <td>
                          {res.advanced
                            ? <span className="text-xs font-bold" style={{ color: "var(--badge-open-text)" }}>✓ Advanced</span>
                            : <span className="text-xs opacity-30">Eliminated</span>}
                        </td>
                      )}
                      {isFinal && (
                        <td>
                          {round.isComplete
                            ? <span className="font-bold text-sm">{res.place ? `${res.place}${["st","nd","rd"][res.place-1] ?? "th"}` : "—"}</span>
                            : (
                              <select className="field-input py-1 text-sm w-28"
                                value={places[res.teamId] ?? ""}
                                onChange={e => setPlaces({ ...places, [res.teamId]: +e.target.value })}>
                                <option value="">—</option>
                                {Array.from({ length: placesAwarded }, (_, i) => i + 1).map(n => (
                                  <option key={n} value={n}>{n}{["st","nd","rd"][n-1] ?? "th"} Place</option>
                                ))}
                              </select>
                            )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Action bar */}
            {!round.isComplete && isActive && (
              <div className="flex flex-wrap items-center gap-3 p-4"
                style={{ borderTop: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
                {!isFinal ? (
                  <>
                    <p className="text-xs opacity-50 flex-1">
                      Select exactly {advanceCount} participant{advanceCount !== 1 ? "s" : ""} to advance.
                      {advancing.size > 0 ? ` (${advancing.size} selected)` : ""}
                    </p>
                    <button onClick={handleSaveResults} disabled={saving}
                      className="btn-outline px-4 py-2 text-xs font-medium disabled:opacity-40">
                      Save Results
                    </button>
                    <button onClick={handleAdvance}
                      disabled={saving || !canAdvance || !allResultsEntered}
                      className="btn-primary flex items-center gap-2 px-5 py-2 text-sm font-semibold disabled:opacity-40">
                      {saving ? <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : null}
                      Advance Selected →
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-xs opacity-50 flex-1">
                      Enter results, then assign places for the top {placesAwarded}.
                    </p>
                    <button onClick={handleSaveResults} disabled={saving}
                      className="btn-outline px-4 py-2 text-xs font-medium disabled:opacity-40">
                      Save Results
                    </button>
                    <button onClick={handleAssignPlaces}
                      disabled={saving || Object.keys(places).length < 1}
                      className="btn-primary flex items-center gap-2 px-5 py-2 text-sm font-semibold disabled:opacity-40">
                      {saving ? <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : null}
                      <CheckCircle className="h-4 w-4" /> Confirm Final Places
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Final results summary ─────────────────────────────────────────────────

  const finalRound = rounds.find(r => r.isFinal && r.isComplete);
  const placed     = finalRound?.results.filter(r => r.place != null).sort((a, b) => (a.place ?? 99) - (b.place ?? 99)) ?? [];

  return (
    <div className="space-y-4">
      {/* Summary if final complete */}
      {finalRound && placed.length > 0 && (
        <div className="p-5" style={{ border: "2px solid var(--badge-open-text)", backgroundColor: "var(--badge-open-bg)" }}>
          <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: "var(--badge-open-text)" }}>
            Final Results
          </p>
          <div className="flex flex-wrap gap-4">
            {placed.map(r => (
              <div key={r.teamId} className="flex items-center gap-2">
                <span className="text-lg font-black" style={{ color: "var(--badge-open-text)" }}>
                  {r.place}{["st","nd","rd"][r.place!-1] ?? "th"}
                </span>
                <div>
                  <p className="font-bold text-sm">{getTeamLabel(r.teamId)}</p>
                  <p className="text-xs opacity-60">{getPlayers(r.teamId)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Heats config summary */}
      <div className="flex flex-wrap gap-4 text-xs opacity-50 px-1">
        <span>{rounds.length} rounds total (incl. final)</span>
        <span>·</span>
        <span>{advanceCount} advance per round</span>
        <span>·</span>
        <span>{resultLabel} per participant</span>
        <span>·</span>
        <span>{placesAwarded} places awarded</span>
      </div>

      {/* Round cards */}
      {rounds.map(round => (
        <RoundCard key={round.id} round={round} />
      ))}
    </div>
  );
}
