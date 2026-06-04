/**
 * bracketPrintSvg.ts
 *
 * Generates a 100% pure SVG string (zero HTML / foreignObject) from raw
 * MatchEntry data.  Used exclusively for printing — the screen view keeps its
 * React / HTML card implementation.
 *
 * Every visual element is a native SVG primitive (rect, text, line, path) so
 * it renders identically in Chrome, Firefox, Safari, and inside PDF engines.
 */

import type { MatchEntry } from "@/types/config";

// ─── Layout (mirrors BracketView constants — keep in sync) ───────────────────
const CW     = 240;   // card width
const CH     = 88;    // card height
const SH     = 38;    // slot height
const DH     = 12;    // divider height
const CGAP   = 80;    // column gap
const RPAD   = 28;    // row padding top/bottom
const HDR    = 46;    // header band height
const R      = 5;     // corner radius

// Font stack embedded so the SVG is self-contained
const FONT = "Segoe UI, Arial, Helvetica, sans-serif";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getRoundTitle(n: number): string {
  if (n === 1) return "Final";
  if (n === 2) return "Semi-Final";
  if (n === 4) return "Quarter-Final";
  return `Round of ${n * 2}`;
}

function winnerSlotCY(isTop: boolean): number {
  return isTop ? SH / 2 : SH + DH + SH / 2;
}

// ─── Data builder (same logic as BracketView.buildRounds) ────────────────────

type RoundData = { title: string; matches: (MatchEntry | null)[] };

function buildRounds(koMatches: MatchEntry[]): RoundData[] {
  if (!koMatches.length) return [];

  const byRound = new Map<number, MatchEntry[]>();
  for (const m of [...koMatches].sort((a, b) =>
    a.round !== b.round ? a.round - b.round : a.id.localeCompare(b.id)
  )) {
    if (!byRound.has(m.round)) byRound.set(m.round, []);
    byRound.get(m.round)!.push(m);
  }

  const existing  = [...byRound.keys()].sort((a, b) => a - b);
  const lastCount = byRound.get(existing[existing.length - 1])!.length;

  const rounds: RoundData[] = existing.map(r => ({
    title:   getRoundTitle(byRound.get(r)!.length),
    matches: byRound.get(r)!,
  }));

  let pc = Math.ceil(lastCount / 2);
  while (pc >= 1) {
    rounds.push({ title: getRoundTitle(pc), matches: Array(pc).fill(null) });
    if (pc === 1) break;
    pc = Math.ceil(pc / 2);
  }
  return rounds;
}

// ─── Coordinate helpers ───────────────────────────────────────────────────────

function bH(firstCount: number): number {
  return firstCount * CH + Math.max(0, firstCount - 1) * 16 + RPAD * 2;
}

function cardTopY(i: number, count: number, h: number): number {
  const pitch = (h - RPAD * 2) / count;
  return RPAD + pitch * i + pitch / 2 - CH / 2;
}

function colX(ci: number): number {
  return ci * (CW + CGAP);
}

// ─── SVG element builders ─────────────────────────────────────────────────────

/** Truncate a string to fit within maxPx at the given font size (rough estimate: ~0.6× ratio) */
function truncate(text: string, maxPx: number, fontSize: number): string {
  const approxCharW = fontSize * 0.58;
  const maxChars    = Math.floor(maxPx / approxCharW);
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1) + "…";
}

function svgCard(
  x: number, y: number,
  match: MatchEntry | null,
  primary: string,
): string {
  const isDone  = !!match && (match.status === "Completed" || match.status === "Walkover");
  const games   = match?.games ?? [];
  const t1w     = games.filter(g => g.p1 !== "" && g.p2 !== "" && +g.p1 > +g.p2).length;
  const t2w     = games.filter(g => g.p1 !== "" && g.p2 !== "" && +g.p2 > +g.p1).length;

  const score1  = !match ? null : match.walkover ? (match.walkoverWinner === "team1" ? "W/O" : "—") : isDone ? String(t1w) : null;
  const score2  = !match ? null : match.walkover ? (match.walkoverWinner === "team2" ? "W/O" : "—") : isDone ? String(t2w) : null;
  const winner  = match?.winner ?? null;  // "team1" | "team2" | null

  const showNames = !!match && match.team1.participants.length + match.team2.participants.length <= 4;

  const mkLabel = (t: MatchEntry["team1"]) => {
    const seed = t.seed != null ? `#${t.seed} ` : "";
    return `${seed}${t.label}`;
  };
  const mkSub = (t: MatchEntry["team1"]) =>
    showNames && t.participants.length ? t.participants.join(" / ") : null;

  const sched = match ? [
    match.courtNo,
    match.matchDate ? new Date(match.matchDate).toLocaleDateString("en-SG", { day: "2-digit", month: "short" }) : "",
    match.startTime,
  ].filter(Boolean).join(" · ") : "";

  const isNull   = !match;
  const cardFill = isNull ? "#f8fafc" : "#ffffff";
  const cardStroke = isNull ? "#cbd5e1" : "#cbd5e1";
  const cardOpacity = isNull ? "0.45" : "1";
  const dashArray   = isNull ? "4,3" : "none";

  // Score badge dimensions
  const SCORE_W = 28;
  const TEXT_MAX = CW - 16 - SCORE_W - 8; // text area max px

  const renderSlot = (
    slotY: number,
    label: string | null,
    sub:   string | null,
    score: string | null,
    isWinner: boolean,
  ) => {
    const fill    = isWinner ? primary : "none";
    const textCol = isWinner ? "#ffffff" : (label ? "#1e293b" : "#94a3b8");
    const subCol  = isWinner ? "rgba(255,255,255,0.8)" : "#64748b";
    const displayLabel = label ? truncate(label, TEXT_MAX, 11.5) : "TBD";
    const displaySub   = sub   ? truncate(sub,   TEXT_MAX, 9.5)  : null;

    // Score badge
    const scoreBadge = score != null ? (() => {
      const bx = x + CW - SCORE_W - 6;
      const by = slotY + (SH - 18) / 2;
      const badgeFill   = isWinner ? "rgba(0,0,0,0.22)" : "#e2e8f0";
      const badgeText   = isWinner ? "#ffffff" : "#1e293b";
      return `
        <rect x="${bx}" y="${by}" width="${SCORE_W}" height="18" rx="3" fill="${badgeFill}"/>
        <text x="${bx + SCORE_W / 2}" y="${by + 13}" text-anchor="middle"
          font-family="${FONT}" font-size="12" font-weight="800" fill="${badgeText}">${esc(String(score))}</text>`;
    })() : "";

    const labelY = sub ? slotY + SH / 2 - 2 : slotY + SH / 2 + 4;
    const subY   = slotY + SH / 2 + 10;

    return `
      <rect x="${x}" y="${slotY}" width="${CW}" height="${SH}" fill="${fill}"/>
      <text x="${x + 10}" y="${labelY}"
        font-family="${FONT}" font-size="11.5" font-weight="700"
        fill="${textCol}" font-style="${!label ? "italic" : "normal"}">${esc(displayLabel)}</text>
      ${displaySub ? `<text x="${x + 10}" y="${subY}"
        font-family="${FONT}" font-size="9.5" fill="${subCol}">${esc(displaySub)}</text>` : ""}
      ${scoreBadge}`;
  };

  const slot1Y   = y;
  const divY     = y + SH;
  const slot2Y   = y + SH + DH;

  const label1 = match ? mkLabel(match.team1) : null;
  const label2 = match ? mkLabel(match.team2) : null;
  const sub1   = match ? mkSub(match.team1) : null;
  const sub2   = match ? mkSub(match.team2) : null;

  return `
  <g opacity="${cardOpacity}">
    <!-- card border -->
    <rect x="${x}" y="${y}" width="${CW}" height="${CH}" rx="${R}" ry="${R}"
      fill="${cardFill}" stroke="${cardStroke}" stroke-width="1.5"
      ${isNull ? `stroke-dasharray="${dashArray}"` : ""}/>
    <!-- clip inner content to card bounds -->
    <clipPath id="clip-${x}-${y}">
      <rect x="${x}" y="${y}" width="${CW}" height="${CH}" rx="${R}" ry="${R}"/>
    </clipPath>
    <g clip-path="url(#clip-${x}-${y})">
      ${renderSlot(slot1Y, label1, sub1, score1, winner === "team1")}
      <!-- divider -->
      <rect x="${x}" y="${divY}" width="${CW}" height="${DH}" fill="#f1f5f9"/>
      <line x1="${x}" y1="${divY}" x2="${x + CW}" y2="${divY}" stroke="#e2e8f0" stroke-width="1"/>
      <line x1="${x}" y1="${divY + DH}" x2="${x + CW}" y2="${divY + DH}" stroke="#e2e8f0" stroke-width="1"/>
      ${sched ? `<text x="${x + 8}" y="${divY + DH - 3}"
        font-family="${FONT}" font-size="8.5" font-weight="600" fill="#94a3b8">${esc(sched)}</text>` : ""}
      ${renderSlot(slot2Y, label2, sub2, score2, winner === "team2")}
    </g>
    <!-- card shadow line (bottom) -->
    ${!isNull ? `<line x1="${x + R}" y1="${y + CH}" x2="${x + CW - R}" y2="${y + CH}"
      stroke="rgba(0,0,0,0.07)" stroke-width="2"/>` : ""}
  </g>`;
}

function svgConnector(
  topCardY: number, botCardY: number, nextCardY: number,
  topMatch: MatchEntry | null, botMatch: MatchEntry | null,
  fromX: number, toX: number,
  primary: string,
): string {
  const topWinner = topMatch?.winner ?? null;
  const botWinner = botMatch?.winner ?? null;
  if (!topWinner && !botWinner) return "";

  const spineX   = fromX + 24;
  const topStubY = topWinner ? topCardY + winnerSlotCY(topWinner === "team1") : topCardY + CH / 2;
  const botStubY = botWinner ? botCardY + winnerSlotCY(botWinner === "team1") : botCardY + CH / 2;
  const armY     = nextCardY + SH + DH / 2;
  const bothWon  = !!topWinner && !!botWinner;

  let out = "";
  if (topWinner)
    out += `<path d="M ${fromX} ${topStubY} H ${spineX}" stroke="${primary}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  if (botWinner)
    out += `<path d="M ${fromX} ${botStubY} H ${spineX}" stroke="${primary}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  if (bothWon) {
    out += `<path d="M ${spineX} ${topStubY} V ${botStubY}" stroke="${primary}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    out += `<path d="M ${spineX} ${armY} H ${toX}" stroke="${primary}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  }
  return out;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface PrintSvgOptions {
  primary?: string;    // brand colour, default #e05a2b
  split?:   "top" | "bottom" | null;  // for half-page printing
}

/**
 * Returns a self-contained SVG string ready to embed in a print HTML page.
 * No React, no foreignObject — pure SVG primitives only.
 */
export function buildBracketPrintSvg(
  koMatches: MatchEntry[],
  opts: PrintSvgOptions = {},
): string {
  const primary = opts.primary ?? "#e05a2b";
  const rounds  = buildRounds(koMatches);
  if (!rounds.length) return "";

  const firstCount = rounds[0].matches.length;
  const h          = bH(firstCount);
  const totalW     = rounds.length * (CW + CGAP);
  const totalH     = HDR + h;

  // For split mode, crop viewBox vertically
  let vbY = 0, vbH = totalH;
  if (opts.split === "top")    { vbH = totalH / 2; }
  if (opts.split === "bottom") { vbY = totalH / 2; vbH = totalH / 2; }

  let body = "";

  // ── Headers ──
  rounds.forEach((round, ci) => {
    const x = colX(ci);
    body += `
    <text x="${x + CW / 2}" y="${HDR - 14}"
      text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="700"
      letter-spacing="0.07em" fill="${primary}"
      style="text-transform:uppercase">${esc(round.title)}</text>
    <line x1="${x}" y1="${HDR - 6}" x2="${x + CW}" y2="${HDR - 6}"
      stroke="${primary}" stroke-width="2"/>`;
  });

  // ── Connectors (behind cards) ──
  body += `<g transform="translate(0,${HDR})">`;
  rounds.slice(0, -1).forEach((round, ci) => {
    const nextRound  = rounds[ci + 1];
    const leftCount  = round.matches.length;
    const rightCount = nextRound.matches.length;

    nextRound.matches.forEach((_, rj) => {
      const topIdx = rj * 2;
      const botIdx = rj * 2 + 1;
      if (topIdx >= leftCount) return;

      const topMatch = round.matches[topIdx];
      const botMatch = botIdx < leftCount ? round.matches[botIdx] : null;
      if (!topMatch?.winner && !botMatch?.winner) return;

      body += svgConnector(
        cardTopY(topIdx, leftCount, h),
        botMatch ? cardTopY(botIdx, leftCount, h) : cardTopY(topIdx, leftCount, h),
        cardTopY(rj, rightCount, h),
        topMatch, botMatch,
        colX(ci) + CW, colX(ci + 1),
        primary,
      );
    });
  });
  body += `</g>`;

  // ── Cards ──
  body += `<g transform="translate(0,${HDR})">`;
  rounds.forEach((round, ci) =>
    round.matches.forEach((match, i) => {
      body += svgCard(colX(ci), cardTopY(i, round.matches.length, h), match, primary);
    })
  );
  body += `</g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg"
  viewBox="${0} ${vbY} ${totalW} ${vbH}"
  width="${totalW}" height="${vbH}"
  style="max-width:100%;height:auto;display:block;overflow:visible;font-family:${FONT}">
  ${body}
</svg>`;
}