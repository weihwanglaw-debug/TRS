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

import React from "react";
import type { BracketState, MatchEntry, FixtureFormat } from "@/types/config";

// ─── Layout constants ─────────────────────────────────────────────────────────
const CARD_W    = 260;   // card width
const CARD_H    = 88;    // card height  (slot×2 + divider)
const SLOT_H    = 40;    // each team slot
const DIV_H     = 8;    // divider between match slots
const COL_GAP   = 72;    // horizontal gap between columns
const ROW_PAD   = 28;    // vertical padding above first card and below last
const INTER_GAP = 20;    // min vertical gap between cards in first round
const HDR_H     = 48;    // round header height above the body
const SVG_PAD   = 24;    // breathing room around the bracket canvas
const CANVAS_BG = "var(--color-page-bg)";
const CARD_BG   = "var(--color-row-stripe)";
const CARD_LINE = "var(--color-table-border)";
const TEXT_MAIN = "var(--color-body-text)";
const TEXT_MUTED = "var(--color-disabled-text)";
const LINK_LINE = "color-mix(in srgb, var(--color-body-text) 28%, transparent)";
const PLACEHOLDER_TEXT = "color-mix(in srgb, var(--color-body-text) 46%, transparent)";
const PLACEHOLDER_LINE = "color-mix(in srgb, var(--color-body-text) 18%, transparent)";

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
  for (const m of koMatches) {
    if (!byRound.has(m.round)) byRound.set(m.round, []);
    byRound.get(m.round)!.push(m);
  }

  const existingRounds = [...byRound.keys()].sort((a, b) => a - b);
  const lastCount = byRound.get(existingRounds[existingRounds.length - 1])!.length;

  const rounds: RoundData[] = existingRounds.map(r => ({
    title:   getRoundTitle(byRound.get(r)!.length),
    matches: byRound.get(r)!,
  }));

  // Project placeholder rounds only until the real final exists.
  let projCount = Math.ceil(lastCount / 2);
  while (lastCount > 1 && projCount >= 1) {
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
  const scoreDetail = games
    .filter(g => g.p1 !== "" && g.p2 !== "")
    .map(g => `${g.p1}-${g.p2}`)
    .join(", ");

  const score1  = !match ? null : match.walkover ? (match.walkoverWinner === "team1" ? "W/O" : "—") : isDone ? t1w : null;
  const score2  = !match ? null : match.walkover ? (match.walkoverWinner === "team2" ? "W/O" : "—") : isDone ? t2w : null;

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
  const team1Bye = !!match && (match.team1.label === "BYE" || match.team1.id.startsWith("bye-"));
  const team2Bye = !!match && (match.team2.label === "BYE" || match.team2.id.startsWith("bye-"));
  const inferredWinner = match?.winner ?? (team1Bye && !team2Bye ? "team2" : team2Bye && !team1Bye ? "team1" : null);
  const displayScore1 = score1 ?? (team2Bye && !team1Bye ? "BYE" : null);
  const displayScore2 = score2 ?? (team1Bye && !team2Bye ? "BYE" : null);

  const Slot = ({ team, isWinner, score, detail }: {
    team?: MatchEntry["team1"]; isWinner: boolean; score: number | string | null; detail?: string;
  }) => {
    const seed  = team?.seed != null ? `#${team.seed} ` : "";
    const showPlayers = !!team && team.participants.length > 0 && team.participants.length <= 2;
    const label = team ? `${seed}${showPlayers ? team.participants.join(" / ") : team.label}` : "";
    const sub   = showPlayers ? team.label : null;

    return (
      <div style={{
        height:     SLOT_H,
        display:    "flex",
        alignItems: "center",
        padding:    "0 10px",
        gap:        6,
        background: isWinner ? "var(--color-primary)" : "transparent",
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
            color:         !label ? PLACEHOLDER_TEXT : isWinner ? "var(--color-hero-text)" : TEXT_MAIN,
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
              color:        isWinner ? "var(--color-hero-text)" : TEXT_MUTED,
            }}>
              {sub}
            </div>
          )}
        </div>
        {score != null && (
          <span style={{
            display:    "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            fontSize:    13,
            fontWeight:  800,
            flexShrink:  0,
            minWidth:    detail ? 58 : 26,
            textAlign:   "center",
            padding:     "2px 6px",
            borderRadius: 4,
            background:  isWinner ? "var(--winner-score-bg)" : "var(--color-row-hover)",
            color:       isWinner ? "var(--color-hero-text)" : TEXT_MAIN,
          }}>
            <span style={{ lineHeight: 1 }}>{score}</span>
            {detail && (
              <span style={{
                marginTop: 2,
                fontSize: 8,
                fontWeight: 600,
                lineHeight: 1,
                opacity: 0.85,
                whiteSpace: "nowrap",
              }}>
                {detail}
              </span>
            )}
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
          border:       isNull ? `1px dashed ${PLACEHOLDER_LINE}` : `1px solid ${CARD_LINE}`,
          borderRadius: 6,
          background:   isNull ? "var(--color-row-hover)" : CARD_BG,
          boxShadow:    "none",
          opacity:      isNull ? 0.72 : 1,
          cursor:       match && !isBye ? "pointer" : "default",
          overflow:     "hidden",
          fontFamily:   "inherit",
        }}
      >
        <Slot
          team={match?.team1}
          isWinner={inferredWinner === "team1"}
          score={displayScore1}
          detail={inferredWinner === "team1" && !match?.walkover ? scoreDetail : undefined}
        />
        <div style={{
          height:       sched ? DIV_H : 1,
          flexShrink:   0,
          background:   CARD_LINE,
          borderTop:    "none",
          borderBottom: "none",
          display:      "flex",
          alignItems:   "center",
          padding:      sched ? "0 10px" : 0,
          fontSize:     9,
          fontWeight:   600,
          color:        TEXT_MUTED,
          whiteSpace:   "nowrap",
          overflow:     "hidden",
        }}>
          {sched}
        </div>
        <Slot
          team={match?.team2}
          isWinner={inferredWinner === "team2"}
          score={displayScore2}
          detail={inferredWinner === "team2" && !match?.walkover ? scoreDetail : undefined}
        />
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

  const inferredWinner = (match: MatchEntry | null) => {
    if (!match) return null;
    if (match.winner) return match.winner;
    const team1Bye = match.team1.label === "BYE" || match.team1.id.startsWith("bye-");
    const team2Bye = match.team2.label === "BYE" || match.team2.id.startsWith("bye-");
    return team1Bye && !team2Bye ? "team2" : team2Bye && !team1Bye ? "team1" : null;
  };

  const topWinner = inferredWinner(topMatch);   // "team1" | "team2" | null
  const botWinner = inferredWinner(botMatch);
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

  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* Top stub — only if top match has a winner */}
      <path
        d={`M ${fromX} ${topStubY} H ${spineX}`}
        stroke={topWinner ? primary : LINK_LINE}
        strokeWidth={topWinner ? 2.5 : 2}
      />
      {/* Bottom stub — only if bottom match has a winner */}
      {botMatch && (
        <path
          d={`M ${fromX} ${botStubY} H ${spineX}`}
          stroke={botWinner ? primary : LINK_LINE}
          strokeWidth={botWinner ? 2.5 : 2}
        />
      )}
      {/* Vertical spine + arm — only when both have winners */}
      {botMatch && (
        <path
          d={`M ${spineX} ${spineTopY} V ${spineBotY}`}
          stroke={bothWon ? primary : LINK_LINE}
          strokeWidth={bothWon ? 2.5 : 2}
        />
      )}
      <path
        d={`M ${spineX} ${armY} H ${armX}`}
        stroke={bothWon ? primary : LINK_LINE}
        strokeWidth={bothWon ? 2.5 : 2}
      />
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
        background: CANVAS_BG, border: `1px solid ${CARD_LINE}`, borderRadius: 8,
        padding: "60px 0", textAlign: "center", color: TEXT_MUTED, fontSize: 14,
      }}>
        {bracketState.phase === "group"
          ? "Complete the group phase to generate the knockout bracket."
          : "No bracket generated yet."}
      </div>
    );
  }

  const primary = typeof window !== "undefined"
    ? (getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim() || "currentColor")
    : "currentColor";

  const rounds = buildRounds(koMatches);
  const firstCount = rounds[0].matches.length;
  const h = bodyH(firstCount);
  // Natural dimensions — used as viewBox so SVG scales to fill container
  const contentW = rounds.length * CARD_W + Math.max(0, rounds.length - 1) * COL_GAP;
  const naturalW = contentW + SVG_PAD * 2;
  const naturalH = HDR_H + h + SVG_PAD * 2;

  return (
    <div ref={ref} style={{
      background:   CANVAS_BG,
      border:       `1px solid ${CARD_LINE}`,
      borderRadius: 8,
      overflow:     "auto",
      padding:      "8px 0 16px",
      maxHeight:    "min(72vh, 760px)",
    }}>
      <svg
        viewBox={`0 0 ${naturalW} ${naturalH}`}
        width={naturalW}
        height={naturalH}
        style={{ display: "block", overflow: "visible", fontFamily: "inherit" }}
      >
        <g transform={`translate(${SVG_PAD}, ${SVG_PAD})`}>
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
                  fill: "var(--color-primary)", fontFamily: "inherit",
                }}
              >
                {round.title}
              </text>
              <line
                x1={x} y1={HDR_H - 6}
                x2={x + CARD_W} y2={HDR_H - 6}
                stroke={LINK_LINE} strokeWidth={1.5}
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
        </g>
      </svg>

      <div data-print-exclude="true" style={{ padding: "6px 16px 0", fontSize: 11, color: TEXT_MUTED }}>
        Click any match card to enter or edit the score.
      </div>
    </div>
  );
});

