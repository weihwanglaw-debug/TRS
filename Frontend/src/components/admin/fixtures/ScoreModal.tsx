/**
 * ScoreModal.tsx — Versus result entry
 *
 * Two big panels (Team 1 vs Team 2). Admin clicks one to mark as winner.
 * Game scores are optional (record-keeping only).
 * Remark field added.
 * Walkover toggle → winner selection.
 */

import React, { useState } from "react";
import { Plus, Trash2, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import type { MatchEntry, Official } from "@/types/config";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

const ROLE_SUGGESTIONS = ["Referee", "Linesman", "Umpire", "Court Marshal", "Scorer"];
function genId() { return Math.random().toString(36).slice(2, 8); }

interface Props {
  open:          boolean;
  draft:         MatchEntry | null;
  isLocked:      boolean;
  onClose:       () => void;
  onSave:        () => void;
  onChangeDraft: (d: MatchEntry) => void;
}

// ── Team panel — clickable to select as winner ────────────────────────────────

function TeamPanel({
  team, side, winner, walkover, walkoverWinner, onClick,
}: {
  team: MatchEntry["team1"];
  side: "team1" | "team2";
  winner: MatchEntry["winner"];
  walkover: boolean;
  walkoverWinner: string;
  onClick: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isWinner = walkover ? walkoverWinner === side : winner === side;
  const hasManyPlayers = team.participants.length > 2;

  return (
    <button
      onClick={onClick}
      className="text-left w-full h-full flex flex-col p-5 transition-all"
      style={{
        border: `2px solid ${isWinner ? "var(--color-primary)" : "var(--color-table-border)"}`,
        backgroundColor: isWinner ? "var(--color-row-hover)" : "transparent",
        outline: "none",
      }}>
      {/* Seed badge */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          {team.seed != null && (
            <span className="text-xs font-bold px-1.5 py-0.5"
              style={{ backgroundColor: "var(--color-primary)", color: "var(--color-hero-text)" }}>
              #{team.seed}
            </span>
          )}
          {isWinner && (
            <span className="text-xs font-bold px-2 py-0.5"
              style={{ backgroundColor: "var(--badge-open-text)", color: "white" }}>
              ✓ WINNER
            </span>
          )}
        </div>
      </div>

      {/* Club/org name */}
      <p className="font-bold text-base mb-1 leading-tight" style={{ color: isWinner ? "var(--color-primary)" : undefined }}>
        {team.label}
      </p>

      {/* Players */}
      <div className="flex-1">
        {(expanded ? team.participants : team.participants.slice(0, 2)).map((p, i) => (
          <p key={i} className="text-xs opacity-60 leading-relaxed">{p}</p>
        ))}
        {hasManyPlayers && (
          <button
            onClick={e => { e.stopPropagation(); setExpanded(!expanded); }}
            className="flex items-center gap-1 text-xs mt-1 font-medium"
            style={{ color: "var(--color-primary)" }}>
            {expanded
              ? <><ChevronUp className="h-3 w-3" /> Show less</>
              : <><ChevronDown className="h-3 w-3" /> +{team.participants.length - 2} more</>}
          </button>
        )}
      </div>

      {/* Click hint when no winner selected */}
      {!isWinner && !walkover && winner === null && (
        <p className="text-xs opacity-30 mt-3">Click to select as winner</p>
      )}
    </button>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

export function ScoreModal({ open, draft, isLocked, onClose, onSave, onChangeDraft }: Props) {
  if (!draft) return null;

  const set = (patch: Partial<MatchEntry>) => onChangeDraft({ ...draft, ...patch });

  const updateGame = (idx: number, side: "p1" | "p2", val: string) =>
    set({ games: draft.games.map((g, i) => i === idx ? { ...g, [side]: val } : g) });
  const addGame    = () => set({ games: [...draft.games, { p1: "", p2: "" }] });
  const removeGame = (idx: number) => {
    if (draft.games.length <= 1) return;
    set({ games: draft.games.filter((_, i) => i !== idx) });
  };

  const addOfficial = () => set({ officials: [...draft.officials, { id: genId(), role: "", name: "" }] });
  const updateOfficial = (idx: number, k: keyof Official, v: string) =>
    set({ officials: draft.officials.map((o, i) => i === idx ? { ...o, [k]: v } : o) });
  const removeOfficial = (idx: number) =>
    set({ officials: draft.officials.filter((_, i) => i !== idx) });

  const selectWinner = (side: "team1" | "team2") => {
    if (draft.walkover) return;
    // Toggle off if already selected
    set({ winner: draft.winner === side ? null : side });
  };

  const canSave = draft.walkover ? !!draft.walkoverWinner : draft.winner !== null;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-2xl max-h-[94vh] overflow-y-auto p-0"
        style={{ backgroundColor: "var(--color-page-bg)", border: "1px solid var(--color-table-border)" }}>

        <DialogHeader className="px-7 pt-7 pb-0">
          <DialogTitle className="font-bold text-lg">
            {isLocked ? "Edit Score" : "Enter Score"}
          </DialogTitle>
          {(draft.courtNo || draft.matchDate) && (
            <p className="text-xs opacity-50 mt-1">
              {draft.courtNo && `📍 ${draft.courtNo}  `}
              {draft.matchDate && `📅 ${new Date(draft.matchDate).toLocaleDateString("en-SG", { weekday:"short", day:"2-digit", month:"short" })}  `}
              {draft.startTime && `🕐 ${draft.startTime}${draft.endTime ? `–${draft.endTime}` : ""}`}
              <span className="ml-2 italic opacity-60">(edit in Schedule tab)</span>
            </p>
          )}
        </DialogHeader>

        <div className="px-7 py-5 space-y-5">

          {/* ── Team panels ── */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wide opacity-50 mb-3">
              {draft.walkover ? "Walkover — Select Winner" : "Select Winner — click a team"}
            </p>
            <div className="grid grid-cols-[1fr_48px_1fr] gap-0">
              <TeamPanel team={draft.team1} side="team1"
                winner={draft.winner} walkover={draft.walkover} walkoverWinner={draft.walkoverWinner}
                onClick={() => draft.walkover
                  ? set({ walkoverWinner: "team1" })
                  : selectWinner("team1")} />
              <div className="flex items-center justify-center">
                <span className="font-black text-lg opacity-20">vs</span>
              </div>
              <TeamPanel team={draft.team2} side="team2"
                winner={draft.winner} walkover={draft.walkover} walkoverWinner={draft.walkoverWinner}
                onClick={() => draft.walkover
                  ? set({ walkoverWinner: "team2" })
                  : selectWinner("team2")} />
            </div>
            {/* Intentionally no "Draw/No Result" button here.
               A saved result requires a winner (or a walkover winner), so showing a draw option
               is misleading and looks broken to admins. */}
          </div>

          {/* ── Walkover toggle ── */}
          <div className="flex items-center justify-between gap-3 px-4 py-3"
            style={{ border: "1px solid var(--color-table-border)" }}>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <AlertTriangle className="h-4 w-4 opacity-50 flex-shrink-0" />
              Walkover — one side did not show
            </label>
            <Switch
              checked={draft.walkover}
              onCheckedChange={v => set({ walkover: v, walkoverWinner: "", winner: null })} />
          </div>

          {/* ── Game scores ── */}
          {!draft.walkover && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold uppercase tracking-wide opacity-50">
                  Game Scores <span className="font-normal opacity-60 normal-case">(optional — record keeping)</span>
                </p>
                <button onClick={addGame} className="flex items-center gap-1 text-xs font-medium"
                  style={{ color: "var(--color-primary)" }}>
                  <Plus className="h-3 w-3" /> Add Game
                </button>
              </div>

              <div className="grid grid-cols-[64px_1fr_28px_1fr_32px] gap-2 mb-1.5 px-0.5">
                <span></span>
                <span className="text-xs font-semibold opacity-60 truncate">{draft.team1.label}</span>
                <span></span>
                <span className="text-xs font-semibold opacity-60 truncate">{draft.team2.label}</span>
                <span></span>
              </div>
              {draft.games.map((g, idx) => (
                <div key={idx} className="grid grid-cols-[64px_1fr_28px_1fr_32px] gap-2 mb-2 items-center">
                  <span className="text-xs opacity-40">Game {idx + 1}</span>
                  <input type="number" min="0" className="field-input text-center font-bold"
                    value={g.p1} placeholder="0"
                    onChange={e => updateGame(idx, "p1", e.target.value)} />
                  <span className="text-center opacity-20 font-bold text-lg">–</span>
                  <input type="number" min="0" className="field-input text-center font-bold"
                    value={g.p2} placeholder="0"
                    onChange={e => updateGame(idx, "p2", e.target.value)} />
                  <button onClick={() => removeGame(idx)} disabled={draft.games.length <= 1}
                    className="p-1 opacity-30 hover:opacity-70 disabled:opacity-10">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* ── Officials ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-wide opacity-50">Officials</p>
              <button onClick={addOfficial} className="flex items-center gap-1 text-xs font-medium"
                style={{ color: "var(--color-primary)" }}>
                <Plus className="h-3 w-3" /> Add Official
              </button>
            </div>
            {draft.officials.length === 0 && <p className="text-xs opacity-30">None assigned.</p>}
            {draft.officials.map((o, idx) => (
              <div key={o.id} className="flex gap-2 mb-2 items-center">
                <div className="w-36 flex-shrink-0">
                  <input className="field-input" list={`roles-${idx}`} placeholder="Role"
                    value={o.role} onChange={e => updateOfficial(idx, "role", e.target.value)} />
                  <datalist id={`roles-${idx}`}>
                    {ROLE_SUGGESTIONS.map(r => <option key={r} value={r} />)}
                  </datalist>
                </div>
                <input className="field-input flex-1" placeholder="Full name"
                  value={o.name} onChange={e => updateOfficial(idx, "name", e.target.value)} />
                <button onClick={() => removeOfficial(idx)} className="p-1.5 opacity-30 hover:opacity-70">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

        </div>

        <DialogFooter className="px-7 pb-7 pt-0">
          <button onClick={onClose} className="btn-outline px-5 py-2.5 text-sm">Cancel</button>
          <button onClick={onSave} disabled={!canSave}
            className="btn-primary px-6 py-2.5 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
            Save Result
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
