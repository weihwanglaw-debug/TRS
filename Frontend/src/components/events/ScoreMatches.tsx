import type { ScoreEntry, ScoreMatch } from "@/lib/api/scoresApi";

export function entryName(entry: ScoreEntry) {
  return entry.players.length ? entry.players.join(" / ") : entry.name;
}

export default function ScoreMatches({ matches, live = false }: { matches: ScoreMatch[]; live?: boolean }) {
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
      {live && match.status === "RC" && <p className="public-score-note">Awaiting organiser confirmation</p>}
      {match.outcome === "WO" && <p className="public-score-note">Walkover</p>}
      {match.outcome === "BY" && <p className="public-score-note">BYE</p>}
      {match.remark && <p className="public-score-note whitespace-pre-wrap">{match.remark}</p>}
    </article>)}
  </div>;
}
