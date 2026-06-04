import React from "react";
import type { GroupEntry } from "@/types/config";
import { computeGroupStandings } from "@/lib/fixtureEngine";

interface Props {
  group: GroupEntry;
  advancePerGroup?: number;
}

export function GroupStandingsTable({ group, advancePerGroup = 2 }: Props) {
  const standings = computeGroupStandings(group);
  const anyPlayed = standings.some(s => s.played > 0);

  return (
    <div style={{ border: "1px solid var(--color-table-border)" }}>
      <div className="px-4 py-2.5 font-bold text-xs uppercase tracking-wide"
        style={{ backgroundColor: "var(--color-primary)", color: "var(--color-hero-text)" }}>
        {group.name}
      </div>
      <div className="overflow-x-auto">
        <table className="trs-table">
          <thead>
            <tr>
              <th>#</th><th>Team</th>
              {anyPlayed && <><th>P</th><th>W</th><th>L</th><th>D</th><th>Pts</th></>}
            </tr>
          </thead>
          <tbody>
            {standings.map(s => (
              <tr key={s.team.id}>
                <td className="font-bold text-sm"
                  style={{ color: s.rank <= advancePerGroup ? "var(--color-primary)" : undefined }}>
                  {s.rank}
                </td>
                <td>
                  {s.team.seed != null && (
                    <span className="text-xs font-bold px-1.5 py-0.5 mr-1.5"
                      style={{ backgroundColor: "var(--color-primary)", color: "var(--color-hero-text)" }}>
                      #{s.team.seed}
                    </span>
                  )}
                  <span className="font-medium text-sm">{s.team.label}</span>
                  <div className="text-xs opacity-50">{s.team.participants.join(" / ")}</div>
                </td>
                {anyPlayed && <>
                  <td>{s.played}</td>
                  <td className="font-semibold" style={{ color: "var(--badge-open-text)" }}>{s.wins}</td>
                  <td>{s.losses}</td>
                  <td>{s.draws}</td>
                  <td className="font-bold">{s.points}</td>
                </>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
