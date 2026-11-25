import type { ScoreEntry, ScoreMatch } from "@/lib/api/scoresApi";

export function entryName(entry: ScoreEntry) {
  return entry.players.length ? entry.players.join(" / ") : entry.name;
}

function phaseLabel(match: ScoreMatch, now: number) {
  const seconds = Math.max(0, Math.ceil((Date.parse(match.phaseUntil || "") - now) / 1000)) || 0;
  const timer = seconds > 0 ? " · " + Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0") : "";
  switch (match.gamePhase) {
    case "WU": return "Warm-up" + timer;
    case "IN": return timer ? "Interval" + timer : "Interval · Awaiting resume";
    case "BG": return timer ? "Between games" + timer : "Awaiting Game " + (match.gameNumber || 2);
    case "TP": return "Technical pause";
    case "MP": return "Medical pause";
    case "PP": return "Playing on paper";
    case "RS": return "Awaiting umpire submission";
    case "IP": return "Game " + (match.gameNumber || 1) + " in progress";
    default: return match.status === "RC" ? (match.outcome === "R" ? "Retirement · Awaiting confirmation" : "Awaiting organiser confirmation") : "";
  }
}

export default function ScoreMatches({ matches, live = false, now = Date.now() }: { matches: ScoreMatch[]; live?: boolean; now?: number }) {
  return <div className={`public-scores-grid ${live ? "is-live" : ""}`}>
    {matches.map(match => <article key={match.id} className="public-score-card">
      <div className="public-score-meta">
        <span>{live ? `${match.programName} · ` : ""}{match.group || match.roundLabel}</span>
        <span>{match.court ? `Court ${match.court}` : ""}{match.matchDate ? ` · ${match.matchDate}` : ""}{match.startTime ? ` · ${match.startTime.slice(0, 5)}` : ""}</span>
      </div>
      <div className="public-score-columns" aria-hidden="true"><span>Players</span><span>{match.games.map((_, i) => <span key={i}>G{i + 1}</span>)}{live && <span>Now</span>}</span></div>
      {[match.team1, match.team2].map((entry, index) => {
        const side = index === 0 ? "A" : "B";
        return <div key={side} className={`public-score-player ${match.winner === side ? "is-winner" : ""}`}>
          <span className="public-score-name">{entry.seed ? `[${entry.seed}] ` : ""}{entryName(entry)}{live && match.serverSide === side && <span aria-label="Serving" className="public-score-serving">●</span>}{match.winner === side && <span className="public-score-winner">Winner</span>}</span>
          <span className="public-score-points">
            {match.games.map((g, i) => <span key={i} aria-label={`Game ${i + 1}`}>{index === 0 ? g.a : g.b}</span>)}
            {live && <strong>{index === 0 ? match.scoreA : match.scoreB}</strong>}
          </span>
        </div>;
      })}
      {live && phaseLabel(match, now) && <p className="public-score-note">{phaseLabel(match, now)}</p>}
      {match.outcome === "WO" && <p className="public-score-note">Walkover</p>}
      {match.outcome === "BY" && <p className="public-score-note">BYE</p>}
      {match.remark && !(live && match.outcome === "R" && match.status === "RC") && <p className="public-score-note whitespace-pre-wrap">{match.remark}</p>}
    </article>)}
  </div>;
}
