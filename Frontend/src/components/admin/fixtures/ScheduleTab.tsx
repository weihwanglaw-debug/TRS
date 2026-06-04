/**
 * ScheduleTab.tsx — All matches with inline-editable court/date/time
 *
 * - Grouped by round / group
 * - Court, date, start time, end time are inline-editable (always)
 * - Score entry button links to ScoreModal
 * - Print: Schedule Sheet (sorted by date+time)
 */

import React, { useEffect, useState } from "react";
import { Pencil, Check, X, Printer, ChevronDown, ChevronUp } from "lucide-react";
import type { BracketState, MatchEntry } from "@/types/config";
import { getAllMatches } from "@/lib/fixtureEngine";

interface Props {
  bracketState:    BracketState;
  eventName:       string;
  programName:     string;
  onUpdateSchedule: (matchId: string, s: ScheduleFields) => Promise<void>;
  onOpenScore:     (m: MatchEntry) => void;
}

interface ScheduleFields {
  courtNo:   string;
  matchDate: string;
  startTime: string;
  endTime:   string;
}

// ── Inline editable cell ──────────────────────────────────────────────────────

function InlineEdit({ value, placeholder, type = "text", onChange }: {
  value: string; placeholder: string; type?: string;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(value);

  const commit = () => { onChange(draft); setEditing(false); };
  const cancel = () => { setDraft(value); setEditing(false); };

  if (!editing) return (
    <button onClick={() => { setDraft(value); setEditing(true); }}
      className="flex items-center gap-1 group text-left w-full"
      title="Click to edit">
      <span className={`text-xs ${value ? "" : "opacity-30 italic"}`}>{value || placeholder}</span>
      <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-40 flex-shrink-0" />
    </button>
  );

  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        type={type} value={draft}
        className="field-input py-0.5 text-xs"
        style={{ width: type === "time" ? "6rem" : type === "date" ? "8rem" : "7rem" }}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
      />
      <button onClick={commit}  className="p-0.5" style={{ color: "var(--badge-open-text)" }}><Check className="h-3.5 w-3.5" /></button>
      <button onClick={cancel} className="p-0.5 opacity-40"><X className="h-3.5 w-3.5" /></button>
    </div>
  );
}

// ── Schedule row ──────────────────────────────────────────────────────────────

function ScheduleRow({ match, onUpdate, onOpenScore }: {
  match:        MatchEntry;
  onUpdate:     (s: ScheduleFields) => Promise<void>;
  onOpenScore:  (m: MatchEntry) => void;
}) {
  const [schedule, setSchedule] = useState<ScheduleFields>({
    courtNo:   match.courtNo,
    matchDate: match.matchDate,
    startTime: match.startTime,
    endTime:   match.endTime,
  });
  const [saving, setSaving] = useState(false);

  // If bracketState refreshes (e.g. from another tab action), keep the row inputs in sync.
  useEffect(() => {
    setSchedule({
      courtNo:   match.courtNo,
      matchDate: match.matchDate,
      startTime: match.startTime,
      endTime:   match.endTime,
    });
  }, [match.courtNo, match.matchDate, match.startTime, match.endTime]);

  const update = async (field: keyof ScheduleFields, value: string) => {
    const next = { ...schedule, [field]: value };
    setSchedule(next);
    setSaving(true);
    try {
      await onUpdate(next);
    } finally {
      setSaving(false);
    }
  };

  const isDone = match.status === "Completed" || match.status === "Walkover";
  const isBye  = match.team1.label === "BYE" || match.team2.label === "BYE"
    || match.team1.id.startsWith("bye-") || match.team2.id.startsWith("bye-");

  const statusColor = isDone
    ? { bg: "var(--badge-open-bg)", text: "var(--badge-open-text)" }
    : match.status === "In Progress"
      ? { bg: "var(--badge-soon-bg)", text: "var(--badge-soon-text)" }
      : { bg: "var(--badge-closed-bg)", text: "var(--badge-closed-text)" };

  return (
    <tr style={saving ? { opacity: 0.6 } : undefined}>
      <td><span className="font-mono text-xs">{match.id}</span></td>
      <td><span className="text-xs">{match.roundLabel}</span></td>
      <td>
        <div className="font-medium text-sm">{match.team1.label}</div>
        <div className="text-xs opacity-50">{match.team1.participants.join(" / ")}</div>
      </td>
      <td className="text-center opacity-30 font-bold text-sm">vs</td>
      <td>
        <div className="font-medium text-sm">{match.team2.label}</div>
        <div className="text-xs opacity-50">{match.team2.participants.join(" / ")}</div>
      </td>
      <td>
        <InlineEdit value={schedule.courtNo} placeholder="Court" type="text"
          onChange={v => update("courtNo", v)} />
      </td>
      <td>
        <InlineEdit value={schedule.matchDate} placeholder="Date" type="date"
          onChange={v => update("matchDate", v)} />
      </td>
      <td>
        <InlineEdit value={schedule.startTime} placeholder="Start" type="time"
          onChange={v => update("startTime", v)} />
      </td>
      <td>
        <InlineEdit value={schedule.endTime} placeholder="End" type="time"
          onChange={v => update("endTime", v)} />
      </td>
      <td>
        <span className="inline-flex items-center px-2 py-0.5 text-xs font-semibold whitespace-nowrap"
          style={{ backgroundColor: statusColor.bg, color: statusColor.text }}>
          {match.status}
        </span>
      </td>
      <td>
        <button
          onClick={() => onOpenScore(match)}
          disabled={isBye}
          title={isBye ? "BYE match has no score to enter." : undefined}
          className="btn-primary px-3 py-1.5 text-xs font-semibold whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed">
          {isBye ? "BYE" : (isDone ? "Edit Score" : "Enter Score")}
        </button>
      </td>
    </tr>
  );
}

// ── Match group (by round/label) ──────────────────────────────────────────────

function MatchGroup({ label, matches, onUpdate, onOpenScore }: {
  label:       string;
  matches:     MatchEntry[];
  onUpdate:    (id: string, s: ScheduleFields) => Promise<void>;
  onOpenScore: (m: MatchEntry) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const done = matches.filter(m => m.status === "Completed" || m.status === "Walkover").length;

  return (
    <div style={{ border: "1px solid var(--color-table-border)", marginBottom: 12 }}>
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between px-4 py-3"
        style={{ backgroundColor: "var(--color-row-hover)" }}>
        <div className="flex items-center gap-3">
          <span className="font-bold text-sm">{label}</span>
          <span className="text-xs opacity-50">{matches.length} matches · {done} completed</span>
        </div>
        {collapsed ? <ChevronDown className="h-4 w-4 opacity-40" /> : <ChevronUp className="h-4 w-4 opacity-40" />}
      </button>

      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="trs-table">
            <thead>
              <tr>
                <th>ID</th><th>Round</th><th>Team 1</th>
                <th style={{ width: 32 }}></th>
                <th>Team 2</th>
                <th>Court</th><th>Date</th><th>Start</th><th>End</th>
                <th>Status</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {matches.map(m => (
                <ScheduleRow key={m.id} match={m}
                  onUpdate={s => onUpdate(m.id, s)}
                  onOpenScore={onOpenScore} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Print schedule sheet ──────────────────────────────────────────────────────

function PrintSchedule({ eventName, programName, matches }: {
  eventName: string; programName: string; matches: MatchEntry[];
}) {
  const sorted = [...matches].sort((a, b) => {
    const dateA = `${a.matchDate}T${a.startTime || "23:59"}`;
    const dateB = `${b.matchDate}T${b.startTime || "23:59"}`;
    return dateA.localeCompare(dateB);
  });

  return (
    <div className="hidden print:block schedule-print-only">
      <div className="mb-6 border-b pb-4">
        <h1 className="text-2xl font-bold">{eventName}</h1>
        <h2 className="text-lg">{programName} — Match Schedule</h2>
        <p className="text-sm opacity-60">Printed: {new Date().toLocaleString("en-SG")}</p>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ backgroundColor: "#1E3A5F", color: "white" }}>
            {["Match", "Round", "Team 1", "vs", "Team 2", "Court", "Date", "Time", "Status"].map(h => (
              <th key={h} style={{ padding: "6px 8px", textAlign: h === "vs" ? "center" : "left" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((m, i) => (
            <tr key={m.id} style={{ backgroundColor: i % 2 === 0 ? "white" : "#F3F4F6" }}>
              <td style={{ padding: "5px 8px", fontFamily: "monospace", fontSize: 10 }}>{m.id}</td>
              <td style={{ padding: "5px 8px" }}>{m.roundLabel}</td>
              <td style={{ padding: "5px 8px", fontWeight: 600 }}>{m.team1.label}</td>
              <td style={{ padding: "5px 8px", textAlign: "center", opacity: 0.4 }}>vs</td>
              <td style={{ padding: "5px 8px", fontWeight: 600 }}>{m.team2.label}</td>
              <td style={{ padding: "5px 8px" }}>{m.courtNo || "—"}</td>
              <td style={{ padding: "5px 8px" }}>
                {m.matchDate ? new Date(m.matchDate).toLocaleDateString("en-SG", { day: "2-digit", month: "short" }) : "—"}
              </td>
              <td style={{ padding: "5px 8px" }}>
                {m.startTime ? `${m.startTime}${m.endTime ? `–${m.endTime}` : ""}` : "—"}
              </td>
              <td style={{ padding: "5px 8px" }}>{m.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

type Filter = "all" | "scheduled" | "completed";

// ── Main export ───────────────────────────────────────────────────────────────

export function ScheduleTab({ bracketState, eventName, programName, onUpdateSchedule, onOpenScore }: Props) {
  const [filter, setFilter] = useState<Filter>("all");

  const all = getAllMatches(bracketState);
  const filtered = filter === "all" ? all
    : filter === "scheduled"  ? all.filter(m => m.status === "Scheduled" || m.status === "In Progress")
    : all.filter(m => m.status === "Completed" || m.status === "Walkover");

  // Group by round label
  const grouped = React.useMemo(() => {
    const map = new Map<string, MatchEntry[]>();
    for (const m of filtered) {
      const key = m.groupId ? `Group ${m.groupId}` : m.roundLabel || "Round 1";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return map;
  }, [filtered]);

  const filterBtns: { key: Filter; label: string }[] = [
    { key: "all",       label: `All (${all.length})` },
    { key: "scheduled", label: `Upcoming (${all.filter(m => m.status === "Scheduled" || m.status === "In Progress").length})` },
    { key: "completed", label: `Completed (${all.filter(m => m.status === "Completed" || m.status === "Walkover").length})` },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5 print:hidden">
        <div className="flex gap-1">
          {filterBtns.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className="px-4 py-1.5 text-xs font-semibold transition-colors"
              style={{
                backgroundColor: filter === f.key ? "var(--color-primary)" : "transparent",
                color: filter === f.key ? "var(--color-hero-text)" : "var(--color-body-text)",
                border: "1px solid var(--color-table-border)",
              }}>
              {f.label}
            </button>
          ))}
        </div>
        <button onClick={() => window.print()}
          className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm font-medium">
          <Printer className="h-4 w-4" /> Print Schedule
        </button>
      </div>

      <p className="text-xs opacity-40 mb-4 print:hidden">
        Click any Court, Date, or Time cell to edit it inline. Changes save automatically.
      </p>

      {filtered.length === 0 ? (
        <p className="text-center py-12 text-sm opacity-40">No matches found.</p>
      ) : (
        [...grouped.entries()].map(([label, matches]) => (
          <MatchGroup key={label} label={label} matches={matches}
            onUpdate={(id, s) => onUpdateSchedule(id, s)}
            onOpenScore={onOpenScore} />
        ))
      )}

      <PrintSchedule eventName={eventName} programName={programName} matches={all} />
    </div>
  );
}
