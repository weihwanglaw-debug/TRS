/**
 * BracketView.tsx — Pure custom bracket, no third-party bracket library.
 *
 * Layout:
 *   - Each round is a column of match cards
 *   - Cards are vertically centred between their two feeders
 *   - Connectors:
 *       • A horizontal stub leaves the RIGHT edge of each QF card at the winner-slot Y
 *       • A vertical spine joins the two stubs (only drawn when BOTH feeder matches have a winner)
 *       • A horizontal arm from spine midpoint → left edge of next-round card
 *       • If only one feeder has a winner, draw just that stub (no spine / arm yet)
 *       • If neither feeder has a winner, draw nothing
 */

import React, { useRef, useEffect, useState } from "react";
import type { BracketState, MatchEntry, FixtureFormat } from "@/types/config";

// ─── Layout constants ─────────────────────────────────────────────────────────
const CARD_W    = 260;   // card width
const CARD_H    = 96;    // card height  (slot×2 + divider)
const SLOT_H    = 42;    // each team slot
const DIV_H     = 12;    // schedule divider between slots
const COL_GAP   = 80;    // horizontal gap between columns
const ROW_PAD   = 28;    // vertical padding above first card and below last
const INTER_GAP = 20;    // min vertical gap between cards in first round
const HDR_H     = 50;    // round header height above the body

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRoundTitle(matchCount: number): string {
  if (matchCount === 1) return "Final";
  if (matchCount === 2) return "Semi-Final";
  if (matchCount === 4) return "Quarter-Final";
  return `Round of ${matchCount * 2}`;
}

// Y-coordinate of the winner slot centre WITHIN a card (relative to card top)
function winnerSlotCY(isTeam1Winner: boolean): number {
  // top slot centre = SLOT_H/2, bottom slot centre = SLOT_H + DIV_H + SLOT_H/2
  return isTeam1Winner ? SLOT_H / 2 : SLOT_H + DIV_H + SLOT_H / 2;
}

// ─── Data builder ─────────────────────────────────────────────────────────────

type RoundData = {
  title: string;
  matches: (MatchEntry | null)[];   // null = placeholder TBD
};

function buildRounds(koMatches: MatchEntry[]): RoundData[] {
  if (!koMatches.length) return [];

  const byRound = new Map<number, MatchEntry[]>();
  for (const m of [...koMatches].sort((a, b) =>
    a.round !== b.round ? a.round - b.round : a.id.localeCompare(b.id)
  )) {
    if (!byRound.has(m.round)) byRound.set(m.round, []);
    byRound.get(m.round)!.push(m);
  }

  const existingRounds = [...byRound.keys()].sort((a, b) => a - b);
  const lastCount = byRound.get(existingRounds[existingRounds.length - 1])!.length;

  const rounds: RoundData[] = existingRounds.map(r => ({
    title:   getRoundTitle(byRound.get(r)!.length),
    matches: byRound.get(r)!,
  }));

  // Project placeholder rounds
  let projCount = Math.ceil(lastCount / 2);
  while (projCount >= 1) {
    rounds.push({
      title:   getRoundTitle(projCount),
      matches: Array(projCount).fill(null),
    });
    if (projCount === 1) break;
    projCount = Math.ceil(projCount / 2);
  }

  return rounds;
}

// ─── Coordinate system ────────────────────────────────────────────────────────
// bodyH = total height of the body area (below header) based on first-round match count

function bodyH(firstRoundCount: number): number {
  return firstRoundCount * CARD_H + Math.max(0, firstRoundCount - 1) * INTER_GAP + ROW_PAD * 2;
}

// Y-centre of the i-th card in a column that has `count` cards, given body height `h`
function cardCY(i: number, count: number, h: number): number {
  const pitch = (h - ROW_PAD * 2) / count;
  return ROW_PAD + pitch * i + pitch / 2;
}

// Top Y of the i-th card
function cardTopY(i: number, count: number, h: number): number {
  return cardCY(i, count, h) - CARD_H / 2;
}

// Left X of column ci
function colX(ci: number): number {
  return ci * (CARD_W + COL_GAP);
}

// ─── Match Card (HTML) ────────────────────────────────────────────────────────

function MatchCard({
  match, x, y, onOpenScore,
}: {
  match: MatchEntry | null;
  x: number; y: number;
  onOpenScore?: (m: MatchEntry) => void;
}) {
  const isDone  = !!match && (match.status === "Completed" || match.status === "Walkover");
  const games   = match?.games ?? [];
  const t1w     = games.filter(g => g.p1 !== "" && g.p2 !== "" && +g.p1 > +g.p2).length;
  const t2w     = games.filter(g => g.p1 !== "" && g.p2 !== "" && +g.p2 > +g.p1).length;

  const score1  = !match ? null : match.walkover ? (match.walkoverWinner === "team1" ? "W/O" : "—") : isDone ? t1w : null;
  const score2  = !match ? null : match.walkover ? (match.walkoverWinner === "team2" ? "W/O" : "—") : isDone ? t2w : null;

  const showNames = !!match && match.team1.participants.length + match.team2.participants.length <= 4;

  const sched = match ? [
    match.courtNo,
    match.matchDate ? new Date(match.matchDate).toLocaleDateString("en-SG", { day: "2-digit", month: "short" }) : "",
    match.startTime,
  ].filter(Boolean).join(" · ") : "";

  const isNull = !match;
  const isBye  = !!match && (
    match.team1.label === "BYE" ||
    match.team2.label === "BYE" ||
    match.team1.id.startsWith("bye-") ||
    match.team2.id.startsWith("bye-")
  );

  const Slot = ({ team, isWinner, score }: {
    team?: MatchEntry["team1"]; isWinner: boolean; score: number | string | null;
  }) => {
    const seed  = team?.seed != null ? `#${team.seed} ` : "";
    const label = team ? `${seed}${team.label}` : "";
    const sub   = showNames && team?.participants.length ? team.participants.join(" / ") : null;

    return (
      <div style={{
        height:     SLOT_H,
        display:    "flex",
        alignItems: "center",
        padding:    "0 10px",
        gap:        6,
        background: isWinner ? "var(--color-primary, #e05a2b)" : "transparent",
        overflow:   "hidden",
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize:      12,
            fontWeight:    700,
            lineHeight:    sub ? "1.2" : "1",
            whiteSpace:    "nowrap",
            overflow:      "hidden",
            textOverflow:  "ellipsis",
            fontStyle:     !label ? "italic" : "normal",
            color:         !label ? "#94a3b8" : isWinner ? "#fff" : "#1e293b",
          }}>
            {label || "TBD"}
          </div>
          {sub && (
            <div style={{
              fontSize:     10,
              lineHeight:   "1.2",
              whiteSpace:   "nowrap",
              overflow:     "hidden",
              textOverflow: "ellipsis",
              color:        isWinner ? "rgba(255,255,255,.8)" : "#64748b",
            }}>
              {sub}
            </div>
          )}
        </div>
        {score != null && (
          <span style={{
            fontSize:    13,
            fontWeight:  800,
            flexShrink:  0,
            minWidth:    26,
            textAlign:   "center",
            padding:     "2px 6px",
            borderRadius: 4,
            background:  isWinner ? "rgba(0,0,0,.22)" : "#e2e8f0",
            color:       isWinner ? "#fff" : "#1e293b",
          }}>
            {score}
          </span>
        )}
      </div>
    );
  };

  return (
    <foreignObject x={x} y={y} width={CARD_W} height={CARD_H}>
      <div
        onClick={() => {
          if (!match || !onOpenScore) return;
          if (isBye) return;
          onOpenScore(match);
        }}
        style={{
          width:        CARD_W,
          height:       CARD_H,
          display:      "flex",
          flexDirection: "column",
          border:       isNull ? "1.5px dashed #cbd5e1" : "1.5px solid #cbd5e1",
          borderRadius: 6,
          background:   isNull ? "#f8fafc" : "#fff",
          boxShadow:    isNull ? "none" : "0 1px 5px rgba(0,0,0,.07)",
          opacity:      isNull ? 0.4 : 1,
          cursor:       match && !isBye ? "pointer" : "default",
          overflow:     "hidden",
          fontFamily:   "inherit",
        }}
      >
        <Slot team={match?.team1} isWinner={match?.winner === "team1"} score={score1} />
        <div style={{
          height:       DIV_H,
          flexShrink:   0,
          background:   "#f1f5f9",
          borderTop:    "1px solid #e2e8f0",
          borderBottom: "1px solid #e2e8f0",
          display:      "flex",
          alignItems:   "center",
          padding:      "0 10px",
          fontSize:     9,
          fontWeight:   600,
          color:        "#94a3b8",
          whiteSpace:   "nowrap",
          overflow:     "hidden",
        }}>
          {sched}
        </div>
        <Slot team={match?.team2} isWinner={match?.winner === "team2"} score={score2} />
      </div>
    </foreignObject>
  );
}

// ─── Connector ────────────────────────────────────────────────────────────────
// Draws the ⊏ connector from two feeder cards → one next-round card.
// Rules:
//  - Only draw a stub for a feeder that has a winner
//  - Only draw the spine + arm if BOTH feeders have a winner

function Connector({
  topCardY, botCardY, nextCardY,
  topMatch, botMatch,
  fromX, toX,
  primary,
}: {
  topCardY: number; botCardY: number; nextCardY: number;
  topMatch: MatchEntry | null; botMatch: MatchEntry | null;
  fromX: number; toX: number;
  primary: string;
}) {
  const spineX = fromX + 24;   // stub length
  const armX   = toX;

  const topWinner = topMatch?.winner;   // "team1" | "team2" | null
  const botWinner = botMatch?.winner;
  const bothWon   = !!topWinner && !!botWinner;

  // Y where stub leaves the TOP card (at winner slot centre)
  const topStubY = topWinner
    ? topCardY + winnerSlotCY(topWinner === "team1")
    : topCardY + CARD_H / 2;

  // Y where stub leaves the BOTTOM card
  const botStubY = botWinner
    ? botCardY + winnerSlotCY(botWinner === "team1")
    : botCardY + CARD_H / 2;

  // Midpoint of spine → arm
  const spineTopY = topStubY;
  const spineBotY = botStubY;
  const armY      = nextCardY + SLOT_H + DIV_H / 2;  // aim at divider centre of next card

  const color = (won: boolean) => won ? primary : "#cbd5e1";
  const width = (won: boolean) => won ? 2.5 : 1.5;

  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* Top stub — only if top match has a winner */}
      {topWinner && (
        <path
          d={`M ${fromX} ${topStubY} H ${spineX}`}
          stroke={primary}
          strokeWidth={2.5}
        />
      )}
      {/* Bottom stub — only if bottom match has a winner */}
      {botWinner && (
        <path
          d={`M ${fromX} ${botStubY} H ${spineX}`}
          stroke={primary}
          strokeWidth={2.5}
        />
      )}
      {/* Vertical spine + arm — only when both have winners */}
      {bothWon && (
        <>
          <path
            d={`M ${spineX} ${spineTopY} V ${spineBotY}`}
            stroke={primary}
            strokeWidth={2.5}
          />
          <path
            d={`M ${spineX} ${armY} H ${armX}`}
            stroke={primary}
            strokeWidth={2.5}
          />
        </>
      )}
    </g>
  );
}

// ─── Public export ────────────────────────────────────────────────────────────

export const BracketView = React.forwardRef<HTMLDivElement, {
  bracketState: BracketState;
  format?: FixtureFormat;
  onOpenScore?: (m: MatchEntry) => void;
}>(function BracketView({ bracketState, onOpenScore }, ref) {
  const koMatches = bracketState.matches;

  if (koMatches.length === 0) {
    return (
      <div ref={ref} style={{
        background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8,
        padding: "60px 0", textAlign: "center", color: "#94a3b8", fontSize: 14,
      }}>
        {bracketState.phase === "group"
          ? "Complete the group phase to generate the knockout bracket."
          : "No bracket generated yet."}
      </div>
    );
  }

  const primary = typeof window !== "undefined"
    ? (getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim() || "#e05a2b")
    : "#e05a2b";

  const rounds = buildRounds(koMatches);
  const firstCount = rounds[0].matches.length;
  const h = bodyH(firstCount);
  // Natural dimensions — used as viewBox so SVG scales to fill container
  const naturalW = rounds.length * (CARD_W + COL_GAP);
  const naturalH = HDR_H + h;

  return (
    <div ref={ref} style={{
      background:   "#fff",
      border:       "1px solid #e2e8f0",
      borderRadius: 8,
      overflowX:    "auto",
      padding:      "4px 0 16px",
    }}>
      <svg
        viewBox={`0 0 ${naturalW} ${naturalH}`}
        width="100%"
        style={{ display: "block", overflow: "visible", fontFamily: "inherit", minWidth: naturalW }}
      >
        {/* ── Round headers ── */}
        {rounds.map((round, ci) => {
          const x = colX(ci);
          return (
            <g key={`hdr-${ci}`}>
              <text
                x={x + CARD_W / 2}
                y={HDR_H - 14}
                textAnchor="middle"
                style={{
                  fontSize: 11, fontWeight: 700,
                  textTransform: "uppercase", letterSpacing: "0.07em",
                  fill: primary, fontFamily: "inherit",
                }}
              >
                {round.title}
              </text>
              <line
                x1={x} y1={HDR_H - 6}
                x2={x + CARD_W} y2={HDR_H - 6}
                stroke={primary} strokeWidth={2}
              />
            </g>
          );
        })}

        {/* ── Connectors (drawn behind cards) ── */}
        <g transform={`translate(0, ${HDR_H})`}>
          {rounds.slice(0, -1).map((round, ci) => {
            const nextRound  = rounds[ci + 1];
            const leftCount  = round.matches.length;
            const rightCount = nextRound.matches.length;

            return nextRound.matches.map((_, rj) => {
              const topIdx = rj * 2;
              const botIdx = rj * 2 + 1;
              if (topIdx >= leftCount) return null;

              const topMatch  = round.matches[topIdx];
              const botMatch  = botIdx < leftCount ? round.matches[botIdx] : null;
              const nextMatch = nextRound.matches[rj];

              // Skip connector entirely if neither feeder has a winner
              if (!topMatch?.winner && !botMatch?.winner) return null;

              const topCardTopY  = cardTopY(topIdx, leftCount, h);
              const botCardTopY  = botMatch ? cardTopY(botIdx, leftCount, h) : topCardTopY;
              const nextCardTopY = cardTopY(rj, rightCount, h);

              return (
                <Connector
                  key={`conn-${ci}-${rj}`}
                  topCardY={topCardTopY}
                  botCardY={botCardTopY}
                  nextCardY={nextCardTopY}
                  topMatch={topMatch}
                  botMatch={botMatch}
                  fromX={colX(ci) + CARD_W}
                  toX={colX(ci + 1)}
                  primary={primary}
                />
              );
            });
          })}
        </g>

        {/* ── Cards ── */}
        <g transform={`translate(0, ${HDR_H})`}>
          {rounds.map((round, ci) =>
            round.matches.map((match, i) => (
              <MatchCard
                key={`card-${ci}-${i}`}
                match={match}
                x={colX(ci)}
                y={cardTopY(i, round.matches.length, h)}
                onOpenScore={onOpenScore}
              />
            ))
          )}
        </g>
      </svg>

      <div style={{ padding: "6px 16px 0", fontSize: 11, color: "#94a3b8" }}>
        Click any match card to enter or edit the score.
      </div>
    </div>
  );
});
