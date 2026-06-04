/**
 * DrawTab.tsx — Bracket/groups display + player swap
 *
 * readOnly=true  → preview mode (wizard step 4): swap works, no score entry, no print
 * readOnly=false → live mode: swap locked once scores entered, print available
 */

import React, { useState, useRef } from "react";
import { ArrowLeftRight, Lock, Printer, FileDown } from "lucide-react";
import type { BracketState, MatchEntry, TeamEntry } from "@/types/config";
import { isBracketLocked, computeGroupStandings } from "@/lib/fixtureEngine";
import { BracketView } from "./BracketView";
import { buildBracketPrintSvg } from "./bracketPrintSvg";
import { NoticeDialog } from "@/components/ui/NoticeDialog";

interface Props {
  bracketState:     BracketState;
  eventName:        string;
  programName:      string;
  readOnly?:        boolean;                                    // preview mode
  onOpenScore?:     (m: MatchEntry) => void;                   // live only
  onSwap?:          (idA: string, idB: string) => Promise<void>; // live: calls API
  onSwapInMemory?:  (idA: string, idB: string) => void;        // preview: mutates local state
}

// ── Print draw sheet (DOM-capture) ──────────────────────────────────────────
//
// Captures the live rendered SVG bracket + group tables from the DOM,
// resolves CSS variables to concrete values, then opens a silent print window.
// "Download PDF" → opens blank tab, writes content, auto-triggers print dialog,
// closes the tab after the dialog is dismissed.

function resolveCssVars(el: Element): void {
  const computed = window.getComputedStyle(document.documentElement);
  const resolve  = (val: string) =>
    val.replace(/var\(([^)]+)\)/g, (_, v) => computed.getPropertyValue(v.trim()).trim());

  // Fix inline style properties
  el.querySelectorAll<HTMLElement>("[style]").forEach(node => {
    const s = node.style;
    for (let i = 0; i < s.length; i++) {
      const prop = s[i];
      const val  = s.getPropertyValue(prop);
      if (val.includes("var(--")) s.setProperty(prop, resolve(val));
    }
  });

  // Fix SVG elements: fill/stroke attributes AND style.fill / style.stroke
  el.querySelectorAll("*").forEach(node => {
    // Attributes
    ["fill", "stroke", "color"].forEach(attr => {
      const v = node.getAttribute(attr) ?? "";
      if (v.includes("var(--")) node.setAttribute(attr, resolve(v));
    });
    // style.fill / style.stroke on SVG/HTML elements
    const s = (node as HTMLElement).style;
    if (!s) return;
    ["fill", "stroke", "color", "background", "background-color", "border-color"].forEach(prop => {
      const v = s.getPropertyValue(prop);
      if (v && v.includes("var(--")) s.setProperty(prop, resolve(v));
    });
  });
}

type CapturedBracket = {
  outerHtml: string;        // full clone HTML (for normal print)
  svgViewBox: string | null; // "0 0 W H" or null
  svgInnerHtml: string | null; // content inside <svg> (for split print)
};

function captureBracket(bracketRef: React.RefObject<HTMLDivElement | null>): CapturedBracket {
  if (!bracketRef.current) return {
    outerHtml: "<p style=\"color:#999;font-style:italic\">No bracket generated.</p>",
    svgViewBox: null,
    svgInnerHtml: null,
  };

  const clone = bracketRef.current.cloneNode(true) as HTMLElement;
  resolveCssVars(clone);
  clone.querySelectorAll(".minimap, button").forEach(n => n.remove());
  clone.querySelectorAll<HTMLElement>("[style]").forEach(n => {
    n.style.cursor = "default";
    n.style.boxShadow = "none";
    n.style.transition = "none";
  });
  clone.querySelectorAll("svg").forEach(svg => {
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.style.overflow = "visible";
  });
  clone.style.border = "none";
  clone.style.padding = "0";
  clone.style.overflow = "visible";
  clone.style.borderRadius = "0";

  // Grab viewBox from the main SVG for split printing
  const svg = bracketRef.current.querySelector("svg");
  const svgViewBox = svg?.getAttribute("viewBox") ?? null;
  const svgClone   = clone.querySelector("svg");
  const svgInnerHtml = svgClone?.innerHTML ?? null;

  return { outerHtml: clone.outerHTML, svgViewBox, svgInnerHtml };
}

// Legacy wrapper used for normal (non-split) print
function captureSvgHtml(bracketRef: React.RefObject<HTMLDivElement | null>): string {
  return captureBracket(bracketRef).outerHtml;
}

function openPrintWindow(
  eventName:   string,
  programName: string,
  groupHtml:   string,
  svgHtml:     string,       // pure SVG string(s) — already safe to embed
  autoPrint:   boolean,
  isSplit?:    boolean,
): void {
  const now = new Date().toLocaleString("en-SG", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  const html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<title>${programName} — Draw Sheet</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #111; background: white; padding: 28px 32px; font-size: 13px; }

  /* Header */
  .ph { border-bottom: 3px solid #1E3A5F; padding-bottom: 14px; margin-bottom: 24px; display:flex; justify-content:space-between; align-items:flex-end; }
  .ph-left h1 { font-size: 20px; font-weight: 800; color: #1E3A5F; margin-bottom: 2px; }
  .ph-left h2 { font-size: 14px; font-weight: 400; color: #555; }
  .ph-meta    { font-size: 11px; color: #aaa; text-align:right; }

  /* Section title */
  .sec-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em;
    color: #1E3A5F; border-bottom: 2px solid #1E3A5F; padding-bottom: 4px; margin-bottom: 14px; }

  /* Group tables */
  .group-block { margin-bottom: 22px; }
  .group-name  { background: #1E3A5F; color: white; padding: 5px 10px; font-weight: 700; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 0; }
  th { background: #2d4f7c; color: white; padding: 5px 8px; text-align: left; font-size: 10px; font-weight: 600; }
  td { padding: 5px 8px; border-bottom: 1px solid #eee; }
  tr:nth-child(even) td { background: #f7f9fb; }
  .seed-badge { background: #1E3A5F; color: white; font-size: 9px; font-weight: 700;
    padding: 1px 4px; margin-right: 3px; display: inline-block; }

  /* Bracket section */
  .bracket-wrap { margin-top: 24px; }
  .bracket-inner { overflow: visible; }

  /* Footer */
  .pf { margin-top: 24px; padding-top: 10px; border-top: 1px solid #ddd;
    font-size: 10px; color: #aaa; display: flex; justify-content: space-between; }

  /* Print bar (hidden when printing) */
  .no-print { background: #1E3A5F; color: white; padding: 10px 20px; margin: -28px -32px 28px;
    display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .no-print span { font-size: 13px; font-weight: 700; }
  .no-print button { background: white; color: #1E3A5F; border: none; font-weight: 700;
    font-size: 12px; padding: 6px 16px; cursor: pointer; }

  /* Split-print page break */
  .page-break { display: none; }
  .pg2-header { display: none; }

  @media print {
    .no-print { display: none; }
    body { padding: 10px; }
    @page { margin: 8mm; size: A4 landscape; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }

    /* Scale bracket SVG to fit page */
    .bracket-inner { width: 100%; overflow: visible; }
    .bracket-inner > div { border: none !important; padding: 0 !important; border-radius: 0 !important; }
    .bracket-inner svg { width: 100% !important; height: auto !important; max-width: 100% !important; }

    /* Split mode: each half fills its page */
    .bracket-inner.split svg { width: 100% !important; height: auto !important; }
    .page-break { display: block; page-break-after: always; break-after: page; height: 0; }
    .pg2-header { display: block; border-bottom: 3px solid #1E3A5F; padding-bottom: 10px; margin-bottom: 16px; }
    .pg2-header h1 { font-size: 18px; font-weight: 800; color: #1E3A5F; }
    .pg2-header h2 { font-size: 13px; font-weight: 400; color: #555; }
    .bracket-wrap { page-break-before: auto; }
    .pf { display: none; }
  }
</style>
</head><body>

<div class="no-print">
  <span>${programName} — Draw Sheet</span>
  <button onclick="window.print()">🖨 Print / Save as PDF</button>
</div>

<div class="ph">
  <div class="ph-left">
    <h1>${eventName}</h1>
    <h2>${programName} — Draw Sheet</h2>
  </div>
  <div class="ph-meta">Generated<br>${now}</div>
</div>

${groupHtml}

${svgHtml ? '<div class="bracket-wrap">' +
  (isSplit
    ? '<div class="sec-title">Knockout Bracket — Top Half</div><div class="bracket-inner">' + svgHtml + '</div>'
    : '<div class="sec-title">Knockout Bracket</div><div class="bracket-inner">' + svgHtml + '</div>'
  ) + '</div>'
  : ""}

<div class="pf">
  <span>${eventName} · ${programName}</span>
  <span>Generated ${now}</span>
</div>

${autoPrint ? `<script>
window.addEventListener("load", function() {
  setTimeout(function() {
    window.print();
    // Close after print dialog dismissed (works in most modern browsers)
    window.addEventListener("afterprint", function() { window.close(); });
    // Fallback: close after 30 s in case afterprint doesn't fire
    setTimeout(function() { window.close(); }, 30000);
  }, 600);
});
<\/script>` : ""}
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) return "Pop-up blocked. Please allow pop-ups for this site and try again.";
  w.document.open();
  w.document.write(html);
  w.document.close();
  return null;
}

// ── Player swap panel ─────────────────────────────────────────────────────────

// ── Player swap panel ─────────────────────────────────────────────────────────

function SwapPanel({ state, onSwap, onSwapInMemory, readOnly }: {
  state:            BracketState;
  onSwap?:          (a: string, b: string) => Promise<void>;
  onSwapInMemory?:  (a: string, b: string) => void;
  readOnly:         boolean;
}) {
  const locked = !readOnly && isBracketLocked(state);
  const [selA, setSelA] = useState("");
  const [selB, setSelB] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastSwap, setLastSwap] = useState("");

  const allTeams = React.useMemo<TeamEntry[]>(() => {
    const seen = new Map<string, TeamEntry>();
    const add = (t: TeamEntry) => { if (!seen.has(t.id)) seen.set(t.id, t); };
    state.groups.flatMap(g => g.matches).forEach(m => { add(m.team1); add(m.team2); });
    state.matches.forEach(m => { add(m.team1); add(m.team2); });
    return [...seen.values()]
      .filter(t => !t.label.startsWith("BYE"))
      .sort((a, b) => {
        if (a.seed != null && b.seed != null) return a.seed - b.seed;
        if (a.seed != null) return -1;
        if (b.seed != null) return 1;
        return a.label.localeCompare(b.label);
      });
  }, [state]);

  const teamLabel = (t: TeamEntry) =>
    `${t.seed != null ? `[#${t.seed}] ` : ""}${t.label}`;

  const handleSwap = async () => {
    if (!selA || !selB || selA === selB) return;
    const ta = allTeams.find(t => t.id === selA);
    const tb = allTeams.find(t => t.id === selB);
    setBusy(true);
    if (readOnly && onSwapInMemory) {
      onSwapInMemory(selA, selB);
      setLastSwap(`Swapped ${ta?.label} ↔ ${tb?.label}`);
    } else if (onSwap) {
      await onSwap(selA, selB);
      setLastSwap(`Swapped ${ta?.label} ↔ ${tb?.label}`);
    }
    setSelA(""); setSelB("");
    setBusy(false);
    setTimeout(() => setLastSwap(""), 3000);
  };

  if (locked) return (
    <div className="flex items-center gap-2 px-4 py-3 text-sm"
      style={{ backgroundColor: "var(--badge-soon-bg)", border: "1px solid var(--color-table-border)" }}>
      <Lock className="h-4 w-4 flex-shrink-0" style={{ color: "var(--badge-soon-text)" }} />
      <span style={{ color: "var(--badge-soon-text)" }}>
        Bracket locked — scores have been entered. Player positions cannot be changed.
      </span>
    </div>
  );

  return (
    <div className="p-4" style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
      <p className="text-xs font-bold uppercase tracking-wide opacity-50 mb-3">
        Swap Player Positions
        {readOnly && <span className="ml-2 normal-case font-normal opacity-80">— preview mode, changes will be saved when you confirm</span>}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-36">
          <label className="block text-xs font-semibold mb-1.5 opacity-60">Player A</label>
          <select className="field-input w-full" value={selA} onChange={e => setSelA(e.target.value)}>
            <option value="">Select…</option>
            {allTeams.map(t => (
              <option key={t.id} value={t.id} disabled={t.id === selB}>{teamLabel(t)}</option>
            ))}
          </select>
        </div>
        <div className="flex-shrink-0 pb-1">
          <ArrowLeftRight className="h-5 w-5 opacity-40" />
        </div>
        <div className="flex-1 min-w-36">
          <label className="block text-xs font-semibold mb-1.5 opacity-60">Player B</label>
          <select className="field-input w-full" value={selB} onChange={e => setSelB(e.target.value)}>
            <option value="">Select…</option>
            {allTeams.map(t => (
              <option key={t.id} value={t.id} disabled={t.id === selA}>{teamLabel(t)}</option>
            ))}
          </select>
        </div>
        <button onClick={handleSwap}
          disabled={!selA || !selB || selA === selB || busy}
          className="btn-primary flex items-center gap-2 px-5 py-2.5 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0">
          {busy
            ? <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : <ArrowLeftRight className="h-4 w-4" />}
          Swap
        </button>
      </div>
      {lastSwap && (
        <p className="text-xs font-semibold mt-2" style={{ color: "var(--badge-open-text)" }}>✓ {lastSwap}</p>
      )}
      {selA && selB && selA !== selB && !lastSwap && (() => {
        const ta = allTeams.find(t => t.id === selA);
        const tb = allTeams.find(t => t.id === selB);
        return (
          <p className="text-xs opacity-50 mt-2">
            Swapping <strong>{ta?.label}</strong> and <strong>{tb?.label}</strong> across all their matches.
          </p>
        );
      })()}
    </div>
  );
}

// ── Group standings ───────────────────────────────────────────────────────────

function GroupStandings({ state }: { state: BracketState }) {
  if (!state.groups.length) return null;
  return (
    <div className="space-y-4">
      {state.groups.map(grp => {
        const standings = computeGroupStandings(grp);
        const anyPlayed = standings.some(s => s.played > 0);
        return (
          <div key={grp.id} style={{ border: "1px solid var(--color-table-border)" }}>
            <div className="px-4 py-2.5 font-bold text-xs uppercase tracking-wide"
              style={{ backgroundColor: "var(--color-primary)", color: "var(--color-hero-text)" }}>
              {grp.name}
            </div>
            <div className="overflow-x-auto">
              <table className="trs-table">
                <thead>
                  <tr>
                    <th>#</th><th>Team</th><th>Players</th>
                    {anyPlayed && <><th>P</th><th>W</th><th>L</th><th>D</th><th>GF</th><th>GA</th><th>Pts</th></>}
                  </tr>
                </thead>
                <tbody>
                  {standings.map(s => (
                    <tr key={s.team.id}>
                      <td className="text-sm font-bold"
                        style={{ color: anyPlayed && s.rank <= (state.config.advancePerGroup ?? 2) ? "var(--color-primary)" : undefined }}>
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
                      </td>
                      <td className="text-xs opacity-70">{s.team.participants.join(" / ")}</td>
                      {anyPlayed && <>
                        <td>{s.played}</td>
                        <td className="font-semibold" style={{ color: "var(--badge-open-text)" }}>{s.wins}</td>
                        <td>{s.losses}</td>
                        <td>{s.draws}</td>
                        <td>{s.gamesFor}</td>
                        <td>{s.gamesAgainst}</td>
                        <td className="font-bold">{s.points}</td>
                      </>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function DrawTab({
  bracketState, eventName, programName,
  readOnly = false, onOpenScore, onSwap, onSwapInMemory,
}: Props) {
  const hasGroups  = bracketState.groups.length > 0;
  const hasKo      = bracketState.matches.length > 0;
  const showSwap   = readOnly || !isBracketLocked(bracketState);
  const bracketRef = useRef<HTMLDivElement | null>(null);
  const groupsRef  = useRef<HTMLDivElement | null>(null);
  const [notice, setNotice] = useState("");

  // Determine if bracket is large enough to warrant split printing (16+ players = 8+ QF matches)
  const firstRoundCount = bracketState.matches.length > 0
    ? bracketState.matches.filter(m => m.round === Math.min(...bracketState.matches.map(x => x.round))).length
    : 0;
  const useSplitPrint = firstRoundCount >= 8;

  const primary = typeof window !== "undefined"
    ? (getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim() || "#e05a2b")
    : "#e05a2b";

  const buildGroupHtml = () => {
    if (!groupsRef.current) return "";
    const clone = groupsRef.current.cloneNode(true) as HTMLElement;
    const computed = window.getComputedStyle(document.documentElement);
    clone.querySelectorAll("[style]").forEach(n => {
      const el = n as HTMLElement;
      const s  = el.style;
      for (let i = 0; i < s.length; i++) {
        const p = s[i];
        const v = s.getPropertyValue(p);
        if (v.includes("var(--")) {
          el.style.setProperty(p, v.replace(/var\(([^)]+)\)/g,
            (_, name) => computed.getPropertyValue(name.trim()).trim()));
        }
      }
    });
    return clone.outerHTML;
  };

  const doPrint = (autoPrint: boolean, split = false) => {
    const groupHtml = buildGroupHtml();
    const ko = bracketState.matches;

    let svgHtml = "";
    if (ko.length > 0) {
      if (split) {
        // Two pure SVGs stacked with a page-break between them
        const topSvg = buildBracketPrintSvg(ko, { primary, split: "top" });
        const botSvg = buildBracketPrintSvg(ko, { primary, split: "bottom" });
        svgHtml = topSvg +
          '<div class="page-break"></div>' +
          '<div class="pg2-header">' +
            `<h1>${eventName}</h1>` +
            `<h2>${programName} — Knockout Bracket (Bottom Half)</h2>` +
          '</div>' +
          '<div class="sec-title" style="margin-bottom:14px">Knockout Bracket — Bottom Half</div>' +
          botSvg;
      } else {
        svgHtml = buildBracketPrintSvg(ko, { primary });
      }
    }

    const message = openPrintWindow(eventName, programName, groupHtml, svgHtml, autoPrint, split);
    if (message) setNotice(message);
  };

  return (
    <div className="space-y-5">
      {/* Action buttons — live mode only */}
      {!readOnly && (
        <div className="flex justify-end gap-2 flex-wrap">
          {useSplitPrint && (
            <button onClick={() => doPrint(false, true)}
              className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm font-medium">
              <Printer className="h-4 w-4" /> Split Print (½ per page)
            </button>
          )}
          <button onClick={() => doPrint(false)}
            className="btn-outline flex items-center gap-1.5 px-4 py-2 text-sm font-medium">
            <Printer className="h-4 w-4" /> Preview &amp; Print
          </button>
          <button onClick={() => doPrint(true)}
            className="btn-primary flex items-center gap-1.5 px-4 py-2 text-sm font-medium">
            <FileDown className="h-4 w-4" /> Download PDF
          </button>
        </div>
      )}

      {/* Swap panel */}
      {showSwap && (
        <SwapPanel
          state={bracketState}
          onSwap={onSwap}
          onSwapInMemory={onSwapInMemory}
          readOnly={readOnly}
        />
      )}
      <NoticeDialog
        open={!!notice}
        onOpenChange={(open) => !open && setNotice("")}
        title="Print Window Blocked"
        description={notice}
      />

      {/* Groups */}
      {hasGroups && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide opacity-50 mb-3">Group Draw</p>
          <div ref={groupsRef}>
            <GroupStandings state={bracketState} />
          </div>
        </div>
      )}

      {/* KO bracket */}
      {hasKo && (
        <div>
          {hasGroups && (
            <p className="text-xs font-bold uppercase tracking-wide opacity-50 mb-3 mt-6">Knockout Bracket</p>
          )}
          <BracketView
            ref={bracketRef}
            bracketState={bracketState}
            onOpenScore={readOnly ? undefined : onOpenScore}
          />
        </div>
      )}

      {!hasGroups && !hasKo && (
        <p className="text-center py-12 text-sm opacity-40">No bracket generated yet.</p>
      )}
    </div>
  );
}
