/**
 * ResultsTab.tsx - Unified fixture table view
 *
 * Shows matches by selected round, lets admins enter results, and keeps
 * court/date scheduling in the same operational table.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Check, FileDown, Pencil, X } from "lucide-react";
import type { BracketState, MatchEntry } from "@/types/config";
import { exportFixtureRoundCsv } from "@/lib/exportCsv";
import { getAllMatches } from "@/lib/fixtureEngine";
import { GroupStandingsTable } from "./GroupStandingsTable";
import { getEntryDisplay } from "@/lib/entryDisplay";

interface ScheduleFields {
  courtNo: string;
  matchDate: string;
  startTime: string;
  endTime: string;
}

interface Props {
  bracketState: BracketState;
  eventName: string;
  programName: string;
  onOpenScore: (m: MatchEntry) => void;
  onUpdateSchedule: (matchId: string, s: ScheduleFields) => Promise<void>;
}

function ScoreStr({ match }: { match: MatchEntry }) {
  if (match.walkover) return <span className="font-mono text-xs">W/O</span>;
  const played = match.games.filter(g => g.p1 !== "" && g.p2 !== "");
  if (!played.length) return <span className="text-xs" style={{ color: "var(--color-disabled-text)" }}>-</span>;
  return (
    <span className="font-mono text-xs">
      {played.map((g, i) => <span key={i}>{i > 0 ? ", " : ""}{g.p1}-{g.p2}</span>)}
    </span>
  );
}

function teamDisplay(team: MatchEntry["team1"]) {
  return getEntryDisplay({ teamMode: team.teamMode, label: team.label, participants: team.participants });
}

function isByeMatch(match: MatchEntry) {
  return match.team1.label === "BYE" || match.team2.label === "BYE"
    || match.team1.id.startsWith("bye-") || match.team2.id.startsWith("bye-");
}

function isResolvedMatch(match: MatchEntry) {
  return match.status === "C" || match.status === "W" || isByeMatch(match);
}

function roundKey(match: MatchEntry) {
  return match.groupId ? `group:${match.groupId}` : `round:${match.round}`;
}

function roundLabel(match: MatchEntry) {
  return match.groupId ? `Group ${match.groupId}` : (match.roundLabel || `Round ${match.round}`);
}

function InlineEdit({ value, placeholder, type = "text", onChange }: {
  value: string;
  placeholder: string;
  type?: string;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    onChange(draft);
    setEditing(false);
  };
  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(value); setEditing(true); }}
        className="flex items-center gap-1 group text-left w-full"
        title="Click to edit">
        <span
          className={`text-xs ${value ? "" : "italic"}`}
          style={{ color: value ? "var(--color-body-text)" : "var(--color-disabled-text)" }}>
          {value || placeholder}
        </span>
        <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-40 flex-shrink-0" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        type={type}
        value={draft}
        className="field-input py-0.5 text-xs"
        style={{ width: type === "date" ? "8rem" : "8.5rem" }}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") cancel();
        }}
      />
      <button onClick={commit} className="p-0.5" style={{ color: "var(--badge-open-text)" }}>
        <Check className="h-3.5 w-3.5" />
      </button>
      <button onClick={cancel} className="p-0.5 opacity-40">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ResultRow({
  match,
  onOpenScore,
  onUpdateSchedule,
}: {
  match: MatchEntry;
  onOpenScore: (m: MatchEntry) => void;
  onUpdateSchedule: (s: ScheduleFields) => Promise<void>;
}) {
  const isDone = match.status === "C" || match.status === "W";
  const isBye = isByeMatch(match);
  const team1 = teamDisplay(match.team1);
  const team2 = teamDisplay(match.team2);
  const [schedule, setSchedule] = useState<ScheduleFields>({
    courtNo: match.courtNo,
    matchDate: match.matchDate,
    startTime: match.startTime,
    endTime: match.endTime,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSchedule({
      courtNo: match.courtNo,
      matchDate: match.matchDate,
      startTime: match.startTime,
      endTime: match.endTime,
    });
  }, [match.courtNo, match.matchDate, match.startTime, match.endTime]);

  const update = async (field: keyof ScheduleFields, value: string) => {
    const next = { ...schedule, [field]: value };
    setSchedule(next);
    setSaving(true);
    try {
      await onUpdateSchedule(next);
    } finally {
      setSaving(false);
    }
  };

  const statusColor = isDone
    ? { bg: "var(--badge-open-bg)", text: "var(--badge-open-text)" }
    : match.status === "In Progress"
      ? { bg: "var(--badge-soon-bg)", text: "var(--badge-soon-text)" }
      : { bg: "var(--badge-closed-bg)", text: "var(--badge-closed-text)" };

  return (
    <tr style={saving ? { opacity: 0.6 } : undefined}>
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
              {team1.main}
            </span>
            {team1.sub && <div className="text-xs" style={{ color: "var(--color-disabled-text)" }}>{team1.sub}</div>}
          </div>
        </div>
      </td>
      <td className="text-center"><ScoreStr match={match} /></td>
      <td>
        <div className="flex items-center gap-1.5">
          {match.team2.seed != null && (
            <span className="text-xs font-bold px-1 py-0.5 flex-shrink-0"
              style={{ backgroundColor: "var(--color-primary)", color: "var(--color-hero-text)" }}>
              #{match.team2.seed}
            </span>
          )}
          <div>
            <span className={`font-medium text-sm ${match.winner === "team2" ? "font-bold" : ""}`}
              style={{ color: match.winner === "team2" ? "var(--color-primary)" : undefined }}>
              {team2.main}
            </span>
            {team2.sub && <div className="text-xs" style={{ color: "var(--color-disabled-text)" }}>{team2.sub}</div>}
          </div>
        </div>
      </td>
      <td>
        <InlineEdit value={schedule.courtNo} placeholder="Court / venue"
          onChange={v => update("courtNo", v)} />
      </td>
      <td>
        <InlineEdit value={schedule.matchDate} placeholder="Date" type="date"
          onChange={v => update("matchDate", v)} />
      </td>
      <td>
        <span className="inline-flex items-center px-2 py-0.5 text-xs font-semibold whitespace-nowrap"
          style={{ backgroundColor: statusColor.bg, color: statusColor.text }}>
          {isBye ? "BYE" : match.status}
        </span>
      </td>
      <td>
        <button
          onClick={() => onOpenScore(match)}
          disabled={isBye}
          title={isBye ? "BYE match has no score to enter." : undefined}
          className="btn-primary px-3 py-1.5 text-xs font-semibold whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed">
          {isBye ? "BYE" : (isDone ? "Edit Result" : "Enter Result")}
        </button>
      </td>
    </tr>
  );
}

export function ResultsTab({ bracketState, eventName, programName, onOpenScore, onUpdateSchedule }: Props) {
  const all = getAllMatches(bracketState);
  const done = all.filter(isResolvedMatch);
  const isGroupStage = bracketState.phase === "group" && bracketState.groups.length > 0;
  const isRoundRobin = bracketState.format === "round_robin";
  const groupSections = useMemo(() => bracketState.groups.map(group => ({
    key: group.id,
    label: group.name,
    matches: group.matches,
  })), [bracketState.groups]);
  const roundOptions = useMemo(() => {
    if (isGroupStage) return [{ key: "group-stage", label: "Group Stage" }];

    const map = new Map<string, string>();
    for (const match of all) {
      const key = roundKey(match);
      if (!map.has(key)) map.set(key, roundLabel(match));
    }
    return [...map.entries()].map(([key, label]) => ({ key, label }));
  }, [all, isGroupStage]);
  const latestRoundKey = roundOptions[roundOptions.length - 1]?.key ?? "";
  const [selectedRoundKey, setSelectedRoundKey] = useState(latestRoundKey);

  useEffect(() => {
    if (!roundOptions.some(o => o.key === selectedRoundKey)) {
      setSelectedRoundKey(latestRoundKey);
    }
  }, [latestRoundKey, roundOptions, selectedRoundKey]);

  const activeRoundKey = selectedRoundKey || latestRoundKey;
  const activeRoundLabel = roundOptions.find(option => option.key === activeRoundKey)?.label ?? "Round";
  const visibleMatches = isGroupStage ? all : all.filter(match => roundKey(match) === activeRoundKey);
  const visibleDone = visibleMatches.filter(isResolvedMatch).length;
  const exportRound = () => exportFixtureRoundCsv(eventName, programName, activeRoundLabel, visibleMatches);
  const renderTable = (matches: MatchEntry[]) => (
    <div className="overflow-x-auto">
      <table className="trs-table">
        <thead>
          <tr>
            <th>Team 1</th>
            <th className="text-center" style={{ width: 120 }}>Result Score</th>
            <th>Team 2</th>
            <th style={{ width: 150 }}>Court / Venue</th>
            <th style={{ width: 150 }}>Date</th>
            <th style={{ width: 110 }}>Status</th>
            <th style={{ width: 120 }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {matches.map(match => (
            <ResultRow
              key={match.id}
              match={match}
              onOpenScore={onOpenScore}
              onUpdateSchedule={s => onUpdateSchedule(match.id, s)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5 print:hidden">
        <div>
          <span className="text-sm font-semibold">{done.length}</span>
          <span className="text-sm opacity-60"> of {all.length} matches completed</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(roundOptions.length > 1 || isGroupStage) && (
            <label className="flex items-center gap-3 px-3 py-2"
              style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
              <span className="text-xs font-bold uppercase tracking-wide opacity-60">Showing</span>
              <select
                className="field-input py-1.5 text-sm font-semibold min-w-52"
                value={activeRoundKey}
                disabled={isGroupStage}
                onChange={e => setSelectedRoundKey(e.target.value)}>
                {roundOptions.map(option => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </label>
          )}
          <button
            onClick={exportRound}
            disabled={visibleMatches.length === 0}
            className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm font-medium disabled:opacity-40">
            <FileDown className="h-4 w-4" /> Export CSV
          </button>
        </div>
      </div>

      {all.length === 0 ? (
        <p className="text-center py-12 text-sm opacity-40">No matches generated yet.</p>
      ) : (
        <>
          {isRoundRobin && bracketState.groups.length > 0 && (
            <div className="mb-6">
              <p className="text-xs font-bold uppercase tracking-wide mb-3"
                style={{ color: "var(--color-body-text)" }}>
                Current Standings
              </p>
              <div className="space-y-4">
                {bracketState.groups.map(group => (
                  <GroupStandingsTable
                    key={group.id}
                    group={group}
                    advancePerGroup={bracketState.config.advancePerGroup ?? group.teams.length}
                    standingPoints={bracketState.config.standingPoints}
                  />
                ))}
              </div>
            </div>
          )}

          {isGroupStage ? (
        <div className="space-y-5">
          {groupSections.map(section => {
            const sectionDone = section.matches.filter(isResolvedMatch).length;
            return (
              <div key={section.key} style={{ border: "1px solid var(--color-table-border)" }}>
                <div className="flex items-center justify-between gap-3 px-4 py-3"
                  style={{ borderBottom: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
                  <span className="text-sm font-bold">{section.label}</span>
                  <span className="text-xs opacity-60">{sectionDone} / {section.matches.length} completed</span>
                </div>
                {renderTable(section.matches)}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ border: "1px solid var(--color-table-border)" }}>
          <div className="flex items-center justify-between gap-3 px-4 py-3"
            style={{ borderBottom: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
            <span className="text-sm font-bold">{activeRoundLabel}</span>
            <span className="text-xs opacity-60">{visibleDone} / {visibleMatches.length} completed</span>
          </div>
          {renderTable(visibleMatches)}
        </div>
          )}
        </>
      )}
    </div>
  );
}
