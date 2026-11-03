import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Radio } from "lucide-react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import ScoreMatches from "@/components/events/ScoreMatches";
import { getLiveScores, getProgramResults, type LiveScores, type ProgramResults } from "@/lib/api/scoresApi";
import { useLiveConfig } from "@/contexts/LiveConfigContext";
import { formatConfiguredDateTime } from "@/lib/dateTime";
import "./event-scores.css";

export default function EventScores({ live = false }: { live?: boolean }) {
  const { id = "" } = useParams();
  const [search, setSearch] = useSearchParams();
  const program = search.get("program") || "";
  const [data, setData] = useState<LiveScores | ProgramResults>();
  const [error, setError] = useState("");
  const [round, setRound] = useState("");
  const [fetchedAt, setFetchedAt] = useState<string>();
  const { cfg } = useLiveConfig();
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    let interval = 5;
    setData(undefined); setError(""); setRound(""); setFetchedAt(undefined);
    async function load() {
      try {
        const next = live ? await getLiveScores(id, controller.signal) : await getProgramResults(id, program, controller.signal);
        if (controller.signal.aborted) return;
        setData(next); setError(""); setFetchedAt(new Date().toISOString());
        if ("refreshSeconds" in next) interval = Math.min(120, Math.max(2, next.refreshSeconds));
      } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
      if (live && !controller.signal.aborted) timer = setTimeout(load, Math.max(2, interval) * 1000);
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [id, program, live]);
  const results = data && "programs" in data ? data : undefined;
  const rounds = [...new Map((data?.matches || []).map(m => [m.phase === "G" ? "G" : `K${m.round}`, { key: m.phase === "G" ? "G" : `K${m.round}`, label: m.phase === "G" ? "Group Stage" : m.roundLabel || `Round ${m.round}`, order: m.phase === "G" ? 0 : m.round }])).values()].sort((a, b) => a.order - b.order);
  const selected = rounds.some(r => r.key === round) ? round : rounds[0]?.key;
  const matches = live ? data?.matches || [] : (data?.matches || []).filter(m => (m.phase === "G" ? "G" : `K${m.round}`) === selected);
  const timestamp = (value: string | null | undefined) => formatConfiguredDateTime(value, cfg.displayTimeZone, cfg.displayDateTimeFormat, "—");
  return <div className="landing-shell min-h-screen flex flex-col public-scores-shell"><Header /><main className="public-scores-main flex-1"><section className="landing-section white public-scores-section"><div className="landing-section-inner">
    <div className="public-scores-header"><div>
      <p className="landing-section-label public-scores-kicker">Tournament /</p>
      <h1 className="landing-section-title public-scores-title">{live ? "Live Scores" : "Results"}</h1>
      {data && <h2 className="public-scores-event">{data.eventName}</h2>}
    </div><Link to={`/event/${id}`} className="landing-button secondary public-scores-back"><ArrowLeft size={16} aria-hidden="true"/>Back to Event</Link></div>
    {error && <p role="alert" className="public-scores-notice">{error}</p>}
    {!data && !error && <p className="public-scores-empty">Loading...</p>}
    {(results || live && data) && <div className="public-scores-toolbar">
    {results && <div className="trs-field public-scores-program"><label htmlFor="score-program">Program</label><select id="score-program" value={results.programId ?? ""} onChange={e => setSearch({ program: e.target.value })}>
      {results.programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select></div>}
    {live && data && <><p className="public-scores-refresh"><Radio size={16} aria-hidden="true"/>Refreshes every {"refreshSeconds" in data ? data.refreshSeconds : 5} seconds</p><dl className="public-scores-timestamps">
      <div><dt>Last fetched</dt><dd data-testid="last-fetched">{timestamp(fetchedAt)}</dd></div>
      <div><dt>Last received from TLS</dt><dd data-testid="last-received">{timestamp(data.receivedAt)}</dd></div>
    </dl></>}
    {!live && data?.receivedAt && <p className="public-scores-received">Last received from TLS: {timestamp(data.receivedAt)}</p>}
    </div>}
    {!live && rounds.length > 0 && <div role="tablist" aria-label="Rounds" className="public-scores-tabs">
      {rounds.map(r => <button key={r.key} role="tab" aria-selected={selected === r.key} className="public-scores-tab" onClick={() => setRound(r.key)}>{r.label}</button>)}
    </div>}
    {data && !data.matches.length && !results?.heats.length && <p className="public-scores-empty">{live ? "No matches currently in progress." : "Results are not available yet."}</p>}
    <ScoreMatches matches={matches} live={live} />
    {results?.heats.map(h => <section key={h.roundNumber} className="public-score-card public-scores-heat"><h3>{h.label}</h3><table className="w-full text-left"><thead><tr><th>Entry</th><th>Result</th><th>Place</th></tr></thead><tbody>{h.results.map((r, i) => <tr key={i}><td className="py-2">{r.name}</td><td>{r.result}</td><td>{r.place ?? (r.advanced ? "Qualified" : "—")}</td></tr>)}</tbody></table></section>)}
  </div></section></main><Footer /></div>;
}
