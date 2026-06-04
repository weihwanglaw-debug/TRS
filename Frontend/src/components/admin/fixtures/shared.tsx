import React, { useState } from "react";
import { Trophy, Users, CheckCircle, Lock } from "lucide-react";
import type { TeamEntry } from "@/types/config";

export function FG({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1.5 opacity-60">{label}</label>
      {children}
    </div>
  );
}

export function TabBtn({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick}
      className="px-5 py-2.5 text-sm font-semibold whitespace-nowrap flex-shrink-0"
      style={{
        borderBottom: active ? "2px solid var(--color-primary)" : "2px solid transparent",
        color: active ? "var(--color-primary)" : "var(--color-body-text)",
        marginBottom: "-2px",
      }}>
      {children}
    </button>
  );
}

export function StepCard({ n, title, description, children }: {
  n: number; title: string; description?: string; children: React.ReactNode;
}) {
  return (
    <div className="p-6" style={{ border: "1px solid var(--color-table-border)" }}>
      <div className="flex items-start gap-4 mb-5">
        <div className="w-8 h-8 flex items-center justify-center text-sm font-bold flex-shrink-0"
          style={{ backgroundColor: "var(--color-primary)", color: "var(--color-hero-text)" }}>
          {n}
        </div>
        <div>
          <p className="font-bold text-sm">{title}</p>
          {description && <p className="text-xs opacity-60 mt-0.5">{description}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

export function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok
        ? <CheckCircle className="h-4 w-4 flex-shrink-0" style={{ color: "var(--badge-open-text)" }} />
        : <Lock        className="h-4 w-4 flex-shrink-0" style={{ color: "var(--badge-closed-text)" }} />}
      <span style={{ color: ok ? "var(--color-body-text)" : "var(--badge-closed-text)" }}>{label}</span>
    </div>
  );
}

export function TeamCell({ team, isWinner }: { team: TeamEntry; isWinner: boolean }) {
  const [open, setOpen] = useState(false);
  const shown = open ? team.participants : team.participants.slice(0, 2);
  return (
    <div className="text-sm min-w-0">
      <div className="flex items-center gap-1.5 flex-wrap">
        {team.seed !== undefined && (
          <span className="text-xs font-bold px-1.5 py-0.5 flex-shrink-0"
            style={{ backgroundColor: "var(--color-primary)", color: "var(--color-hero-text)" }}>
            #{team.seed}
          </span>
        )}
        <span className="font-semibold truncate max-w-[130px]" title={team.label}>{team.label}</span>
        {isWinner && <Trophy className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "var(--color-primary)" }} />}
      </div>
      {shown.map((p, i) => <div key={i} className="text-xs opacity-60 truncate">{p}</div>)}
      {team.participants.length > 2 && (
        <button onClick={() => setOpen(!open)}
          className="text-xs font-medium flex items-center gap-0.5 mt-0.5"
          style={{ color: "var(--color-primary)" }}>
          <Users className="h-3 w-3" />
          {open ? "Show less" : `+${team.participants.length - 2} more`}
        </button>
      )}
    </div>
  );
}

export function TeamPanel({ team, isWinner }: { team: TeamEntry; isWinner: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
        {team.seed !== undefined && (
          <span className="text-xs font-bold px-1.5 py-0.5"
            style={{ backgroundColor: "var(--color-primary)", color: "var(--color-hero-text)" }}>
            #{team.seed}
          </span>
        )}
        {isWinner && <Trophy className="h-4 w-4" style={{ color: "var(--color-primary)" }} />}
      </div>
      <p className="font-bold text-sm">{team.label}</p>
      {team.participants.map((p, i) => <p key={i} className="text-xs opacity-60">{p}</p>)}
    </div>
  );
}